import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';

const storeChannels = new Map<string, Set<string>>();

export let io: Server;

export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: {
      origin: env.SOCKET_CORS_ORIGIN === '*' ? '*' : env.SOCKET_CORS_ORIGIN.split(','),
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    logger.debug(`Socket connected: ${socket.id}`);

    socket.on('join-store', ({ storeId }: { storeId?: string }) => {
      if (!storeId || typeof storeId !== 'string') return;

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

// Emite a toda la sala de la tienda excepto al socket indicado (p. ej. la estación
// que originó la acción), para no notificarle su propio evento. Acepta el valor crudo
// del header 'x-socket-id' (string | string[] | undefined).
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