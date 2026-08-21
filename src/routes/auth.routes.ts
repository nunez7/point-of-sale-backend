import { Router } from 'express';
import { login, logout, me } from '../controllers/auth.controller';
import { loginSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/login', validate(loginSchema), login);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);

export default router;