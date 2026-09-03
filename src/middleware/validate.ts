import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { ApiError } from '../utils/ApiError';

export const validate =
  (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const data =
      source === 'body' ? req.body : source === 'query' ? req.query : req.params;

    const result = schema.safeParse(data);

    if (!result.success) {
      const message = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      return next(
        ApiError.badRequest(message || 'Datos de entrada inválidos', 'VALIDATION_ERROR')
      );
    }

    if (source === 'body') req.body = result.data;
    else if (source === 'query') req.query = result.data as Request['query'];
    else req.params = result.data as Request['params'];

    return next();
  };