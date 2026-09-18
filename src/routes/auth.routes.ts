import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  login,
  logout,
  me,
  updateMe,
  verifyCurrentPassword,
  authorizeCajaClose,
  authorizeCajaOpen,
  changeMyPassword,
  selectStore,
} from '../controllers/auth.controller';
import {
  loginSchema,
  updatePerfilSchema,
  verifyPasswordSchema,
  authorizeCajaCloseSchema,
  authorizeCajaOpenSchema,
  cambiarPasswordSchema,
  selectStoreSchema,
} from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos de inicio de sesión. Intente de nuevo en 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginLimiter, validate(loginSchema), login);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, validate(updatePerfilSchema), updateMe);
router.post('/me/verify-password', requireAuth, validate(verifyPasswordSchema), verifyCurrentPassword);
router.post('/authorize-caja-close', requireAuth, validate(authorizeCajaCloseSchema), authorizeCajaClose);
router.post('/authorize-caja-open', requireAuth, validate(authorizeCajaOpenSchema), authorizeCajaOpen);
router.patch('/me/password', requireAuth, validate(cambiarPasswordSchema), changeMyPassword);
router.post('/select-store', requireAuth, validate(selectStoreSchema), selectStore);

export default router;