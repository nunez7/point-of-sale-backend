import { Response } from 'express';
import { asyncHandler, asyncAuthHandler } from '../utils/asyncHandler';
import * as authService from '../services/auth.service';
import { AuthedRequest } from '../types';

export const login = asyncHandler(async (req, res: Response) => {
  const { email, password } = req.body;

  const result = await authService.login(email, password);
  res.json(result);
});

export const logout = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.split(' ')[1] : '';

  await authService.logout(req.user!.id, token);
  res.json({ message: 'Sesión cerrada correctamente' });
});

export const me = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const user = await authService.getMe(req.user!.id);
  res.json({ user });
});

export const updateMe = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { name, email } = req.body;
  const user = await authService.updateMe(req.user!.id, { name, email });
  res.json({ user, message: 'Perfil actualizado correctamente' });
});

export const changeMyPassword = asyncAuthHandler(
  async (req: AuthedRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body;
    await authService.changeMyPassword(req.user!.id, currentPassword, newPassword);
    res.json({ message: 'Contraseña actualizada correctamente' });
  }
);