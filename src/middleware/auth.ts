import { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { AuthedRequest, AuthedUser, JwtPayload } from '../types';
import { sha256 } from '../utils/tokenHash';
import { asyncHandler } from '../utils/asyncHandler';

export const requireAuth = asyncHandler(
  async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Token no proporcionado', 'MISSING_TOKEN');
    }

    const token = header.split(' ')[1];

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    } catch {
      throw ApiError.unauthorized('Token inválido o expirado', 'INVALID_TOKEN');
    }

    const revoked = await prisma.revokedToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (revoked) {
      throw ApiError.unauthorized('Token revocado', 'REVOKED_TOKEN');
    }

    if (!payload.isActive) {
      throw ApiError.forbidden('Usuario inactivo', 'USER_INACTIVE');
    }

    const authedUser: AuthedUser = {
      id: payload.userId,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      storeId: payload.storeId,
      stores: payload.stores,
      isActive: payload.isActive,
    };

    req.user = authedUser;
    next();
  }
);
