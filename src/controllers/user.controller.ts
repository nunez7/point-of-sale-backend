import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import * as userService from '../services/user.service';
import { AuthedRequest } from '../types';

export const listUsers = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const users = await userService.listUsers(req.user!.storeId);
  res.json({ users });
});

export const createUser = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = await userService.createUser(req.body, req.user!.id);
  res.status(201).json({ user });
});

export const updateUser = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = await userService.updateUser(req.params.id, req.body, req.user!.id);
  res.json({ user });
});

export const deleteUser = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const result = await userService.deleteUser(req.params.id, req.user!.id);
  res.json(result);
});