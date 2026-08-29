import { Router } from 'express';
import {
  login,
  logout,
  me,
  updateMe,
  verifyCurrentPassword,
  authorizeCajaClose,
  authorizeCajaOpen,
  changeMyPassword,
} from '../controllers/auth.controller';
import {
  loginSchema,
  updatePerfilSchema,
  verifyPasswordSchema,
  authorizeCajaCloseSchema,
  authorizeCajaOpenSchema,
  cambiarPasswordSchema,
} from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/login', validate(loginSchema), login);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, validate(updatePerfilSchema), updateMe);
router.post('/me/verify-password', requireAuth, validate(verifyPasswordSchema), verifyCurrentPassword);
router.post('/authorize-caja-close', requireAuth, validate(authorizeCajaCloseSchema), authorizeCajaClose);
router.post('/authorize-caja-open', requireAuth, validate(authorizeCajaOpenSchema), authorizeCajaOpen);
router.patch('/me/password', requireAuth, validate(cambiarPasswordSchema), changeMyPassword);

export default router;