import { Router } from 'express';
import { login, logout, me, updateMe, changeMyPassword } from '../controllers/auth.controller';
import { loginSchema, updatePerfilSchema, cambiarPasswordSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/login', validate(loginSchema), login);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, validate(updatePerfilSchema), updateMe);
router.patch('/me/password', requireAuth, validate(cambiarPasswordSchema), changeMyPassword);

export default router;