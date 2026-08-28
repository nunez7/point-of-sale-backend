import { prisma } from '../config/prisma';
import { env } from '../config/env';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { JwtPayload } from '../types';
import { Role } from '../../generated/prisma/client.js';
import { sha256 } from '../utils/tokenHash';

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

// Contexto de caja del usuario: caja asignada (si la tienda usa control de
// cajas), sesión abierta actual y configuración de la tienda. Permite al
// frontend enlazar la caja automáticamente sin importar el equipo.
export async function buildCajaContext(userId: string, storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { controlCajas: true, aperturaCajaConInventario: true },
  });

  const caja = await prisma.caja.findFirst({
    where: { assignedUserId: userId, storeId, isActive: true },
    select: { id: true, name: true },
  });

  let session: { id: string; cajaId: string; status: string; openedAt: Date } | null = null;
  if (caja) {
    const open = await prisma.cajaSession.findFirst({
      where: { cajaId: caja.id, storeId, status: 'OPEN' },
      select: { id: true, cajaId: true, status: true, openedAt: true },
    });
    if (open) session = open;
  } else {
    // Para ADMIN/GERENTE sin caja asignada: buscar cualquier sesión abierta del usuario
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user && (user.role === Role.ADMIN || user.role === Role.GERENTE)) {
      const open = await prisma.cajaSession.findFirst({
        where: { storeId, userId, status: 'OPEN' },
        select: { id: true, cajaId: true, status: true, openedAt: true },
      });
      if (open) session = open;
    }
  }

  return {
    store: {
      controlCajas: store?.controlCajas ?? false,
      aperturaCajaConInventario: store?.aperturaCajaConInventario ?? false,
    },
    caja,
    session,
  };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw ApiError.unauthorized('Credenciales inválidas', 'INVALID_CREDENTIALS');
  }
  if (!user.isActive) {
    throw ApiError.forbidden('Usuario inactivo', 'USER_INACTIVE');
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw ApiError.unauthorized('Credenciales inválidas', 'INVALID_CREDENTIALS');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const tokenPayload: JwtPayload = {
    userId: user.id,
    storeId: user.storeId,
    role: user.role,
    email: user.email,
  };

  const accessToken = signToken(tokenPayload);

  await audit({
    storeId: user.storeId,
    userId: user.id,
    action: 'LOGIN',
    entity: 'USER',
    entityId: user.id,
    metadata: { email: user.email },
  });

  const publicUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    storeId: user.storeId,
  };

  const cajaContext = await buildCajaContext(user.id, user.storeId);

  return { token: accessToken, user: publicUser, ...cajaContext };
}

export async function logout(userId: string, token: string): Promise<void> {
  if (token) {
    // Blacklist token until it expires (8h)
    await prisma.revokedToken.create({
      data: {
        tokenHash: sha256(token),
        userId: userId || null,
        expiresAt: new Date(Date.now() + 60 * 60 * 8 * 1000),
      },
    });
  }
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await audit({
        storeId: user.storeId,
        userId: user.id,
        action: 'LOGOUT',
        entity: 'USER',
        entityId: user.id,
      });
    }
  }
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      storeId: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
  }

  const cajaContext = await buildCajaContext(userId, user.storeId);

  return { ...user, ...cajaContext };
}

export async function updateMe(
  userId: string,
  data: { name: string; email: string }
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing && existing.id !== userId) {
    throw ApiError.conflict('El email ya está registrado', 'EMAIL_TAKEN');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { name: data.name, email: data.email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      storeId: true,
      isActive: true,
      createdAt: true,
    },
  });

  await audit({
    storeId: user.storeId,
    userId: user.id,
    action: 'UPDATE',
    entity: 'USER',
    entityId: user.id,
    metadata: { changes: { name: data.name, email: data.email } },
  });

  return updated;
}

export async function changeMyPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    throw ApiError.unauthorized(
      'La contraseña actual es incorrecta',
      'INVALID_CURRENT_PASSWORD'
    );
  }

  if (currentPassword === newPassword) {
    throw ApiError.badRequest(
      'La nueva contraseña debe ser diferente a la actual',
      'SAME_PASSWORD'
    );
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  });

  await audit({
    storeId: user.storeId,
    userId: user.id,
    action: 'UPDATE',
    entity: 'USER',
    entityId: user.id,
    metadata: { change: 'password' },
  });
}

export async function verifyCurrentPassword(userId: string, currentPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    throw ApiError.unauthorized(
      'La contraseña actual es incorrecta',
      'INVALID_CURRENT_PASSWORD'
    );
  }

  return { valid: true };
}

export async function authorizeCajaClose(
  storeId: string,
  email: string,
  password: string
) {
  const user = await prisma.user.findFirst({
    where: { email, storeId, isActive: true },
    select: { id: true, email: true, password: true, role: true },
  });
  const valid = user ? await bcrypt.compare(password, user.password) : false;
  if (!valid || (user?.role !== Role.ADMIN && user?.role !== Role.GERENTE)) {
    throw ApiError.forbidden(
      'Solo un administrador o gerente puede autorizar el cierre',
      'CLOSE_CAJA_AUTHORIZATION_REQUIRED'
    );
  }

  const authorizationToken = jwt.sign(
    {
      userId: user!.id,
      storeId,
      role: user!.role,
      email: user!.email,
      purpose: 'CLOSE_CAJA',
    },
    env.JWT_SECRET,
    { expiresIn: '5m' }
  );

  return { authorized: true, authorizationToken };
}