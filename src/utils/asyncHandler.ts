import { NextFunction, Request, Response } from 'express';
import { AuthedRequest } from '../types';

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

export const asyncHandler =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const asyncAuthHandler =
  (fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
  };