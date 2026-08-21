import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { logger } from '../config/logger';

export const notFound = (req: Request, _res: Response, next: NextFunction): void => {
  next(ApiError.notFound(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, 'NOT_FOUND'));
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let status = 500;
  let message = 'Error interno del servidor';
  let code = 'INTERNAL_ERROR';

  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
    code = err.code;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        status = 409;
        message = 'Registro duplicado: el valor único ya existe';
        code = 'UNIQUE_CONSTRAINT_VIOLATION';
        break;
      case 'P2025':
        status = 404;
        message = 'Registro no encontrado';
        code = 'NOT_FOUND';
        break;
      case 'P2003':
        status = 400;
        message = 'Violación de integridad referencial';
        code = 'FOREIGN_KEY_VIOLATION';
        break;
      default:
        status = 500;
        message = 'Error de base de datos';
        code = 'DATABASE_ERROR';
        break;
    }
  } else if (err instanceof Error) {
    message = err.message;
  }

  if (status >= 500) {
    logger.error({
      message: `[${code}] ${message}`,
      url: req.originalUrl,
      method: req.method,
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  res.status(status).json({
    error: message,
    code,
    status,
  });
};