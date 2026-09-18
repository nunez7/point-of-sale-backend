import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { sha256 } from '../utils/tokenHash';
import { logger } from '../config/logger';
import { AuthedUser, JwtPayload } from '../types';

const storeChannels = new Map<string, Set<string>>();

export let io: Server;

async function authenticateSocket(socket: Socket): Promise<AuthedUser | null> {
  try {
    const token =
      socket.handshake.auth?.token ??
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token || typeof token !== 'string') return null;

    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

    const revoked = await prisma.revokedToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (revoked) return null;

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        userStores: { select: { storeId: true, role: true } },
      },
    });

    if (!user || !user.isActive) return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      storeId: payload.storeId,
      stores: user.userStores.map((us) => ({ storeId: us.storeId, role: us.role })),
      isActive: user.isActive,
    };
  } catch {
    return null;
  }
}

export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: {
      origin: env.SOCKET_CORS_ORIGIN === '*' ? '*' : env.SOCKET_CORS_ORIGIN.split(','),
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    const user = await authenticateSocket(socket);
    if (!user) {
      return next(new Error('Autenticación fallida'));
    }
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as AuthedUser;
    logger.debug(`Socket connected: ${socket.id} (user: ${user.id})`);

    socket.on('join-store', ({ storeId }: { storeId?: string }) => {
      if (!storeId || typeof storeId !== 'string') return;

      const belongsToStore = user.stores.some((s) => s.storeId === storeId);
      if (!belongsToStore) {
        logger.warn(`Socket ${socket.id} denied join-store:${storeId} (unauthorized)`);
        return;
      }

      socket.join(`store:${storeId}`);

      if (!storeChannels.has(storeId)) storeChannels.set(storeId, new Set());
      storeChannels.get(storeId)?.add(socket.id);

      logger.debug(`Socket ${socket.id} joined store:${storeId}`);
    });

    socket.on('disconnect', () => {
      for (const [storeId, sockets] of storeChannels.entries()) {
        sockets.delete(socket.id);
        if (sockets.size === 0) storeChannels.delete(storeId);
      }
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function emitToStore(storeId: string, event: string, data: unknown): void {
  io?.to(`store:${storeId}`).emit(event, data);
}

export function emitToStoreExcept(
  storeId: string,
  event: string,
  data: unknown,
  exceptSocketId?: string | string[]
): void {
  if (!io) return;
  const id = Array.isArray(exceptSocketId) ? exceptSocketId[0] : exceptSocketId;
  const channel = io.to(`store:${storeId}`);
  (id ? channel.except(id) : channel).emit(event, data);
}
