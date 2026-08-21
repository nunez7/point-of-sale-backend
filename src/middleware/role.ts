import { NextFunction, Response } from 'express';
import { ROLE_HIERARCHY, Role, AuthedRequest } from '../types';
import { ApiError } from '../utils/ApiError';

export const requireRole =
  (...roles: Role[]) =>
  (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }

    const requiredRank = Math.max(...roles.map((r) => ROLE_HIERARCHY[r]));
    const userRank = ROLE_HIERARCHY[req.user.role];

    if (userRank < requiredRank) {
      return next(
        ApiError.forbidden(
          `Se requiere rol ${roles.join(' o ')} para esta acción`,
          'INSUFFICIENT_ROLE'
        )
      );
    }

    return next();
  };