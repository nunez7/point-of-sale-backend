import { Router } from 'express';
import { getCurrentStore, updateCurrentStore } from '../controllers/store.controller';
import { storeUpdateSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';

const router = Router();

// Cada usuario solo puede consultar/actualizar la tienda a la que pertenece.
router.get('/current', requireAuth, getCurrentStore);
router.patch(
  '/current',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(storeUpdateSchema),
  updateCurrentStore
);

export default router;
