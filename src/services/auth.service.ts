import { prisma } from '../config/prisma';
import { env } from '../config/env';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { JwtPayload } from '../types';
import { sha256 } from '../utils/tokenHash';

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
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

  return { token: accessToken, user: publicUser };
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

  return user;
}