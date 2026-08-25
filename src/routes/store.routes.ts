import { Router } from 'express';
import {
  getCurrentStore,
  updateCurrentStore,
  updateDatosFiscalesStore,
} from '../controllers/store.controller';
import { storeUpdateSchema, storeFiscalesSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

// Cada usuario solo puede consultar/actualizar la tienda a la que pertenece.
router.get('/current', requireAuth, getCurrentStore);
// Los datos fiscales del emisor se completan desde el formulario de
// facturación; cualquier usuario autenticado puede guardarlos.
router.patch(
  '/current/fiscales',
  requireAuth,
  validate(storeFiscalesSchema),
  updateDatosFiscalesStore
);
router.patch(
  '/current',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(storeUpdateSchema),
  updateCurrentStore
);

export default router;
