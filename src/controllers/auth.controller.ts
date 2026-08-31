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

export const selectStore = asyncAuthHandler(
  async (req: AuthedRequest, res: Response) => {
    const { storeId } = req.body;
    const result = await authService.selectStore(req.user!.id, storeId);
    res.json(result);
  }
);

export const updateMe = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const { name, email } = req.body;
  const user = await authService.updateMe(req.user!.id, { name, email });
  res.json({ user, message: 'Perfil actualizado correctamente' });
});

export const verifyCurrentPassword = asyncAuthHandler(
  async (req: AuthedRequest, res: Response) => {
    const { currentPassword } = req.body;
    await authService.verifyCurrentPassword(req.user!.id, currentPassword);
    res.json({ message: 'Contraseña verificada correctamente' });
  }
);

export const authorizeCajaClose = asyncAuthHandler(
  async (req: AuthedRequest, res: Response) => {
    const { email, password } = req.body;
    const authorization = await authService.authorizeCajaClose(
      req.user!.storeId,
      email,
      password
    );
    res.json({
      message: 'Cierre de caja autorizado',
      authorizationToken: authorization.authorizationToken,
    });
  }
);

export const authorizeCajaOpen = asyncAuthHandler(
  async (req: AuthedRequest, res: Response) => {
    const { email, password } = req.body;
    const authorization = await authService.authorizeCajaOpen(
      req.user!.storeId,
      email,
      password
    );
    res.json({
      message: 'Apertura de caja autorizada',
      authorizationToken: authorization.authorizationToken,
    });
  }
);

export const changeMyPassword = asyncAuthHandler(
  async (req: AuthedRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body;
    await authService.changeMyPassword(req.user!.id, currentPassword, newPassword);
    res.json({ message: 'Contraseña actualizada correctamente' });
  }
);