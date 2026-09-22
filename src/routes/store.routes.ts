import { Router } from 'express';
import {
  getCurrentStore,
  updateCurrentStore,
  updateDatosFiscalesStore,
  getAutoCloseConfig,
  updateAutoCloseConfig,
  getMyStores,
  listAllStores,
  createStore,
  updateStoreById,
  deleteStore,
  reactivateStore,
} from '../controllers/store.controller';
import { storeUpdateSchema, storeFiscalesSchema, autoCloseConfigSchema, createStoreSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

// ── /current routes BEFORE /:id to avoid Express matching "current" as an id ──

// Tiendas del usuario autenticado (solo activas).
router.get('/my-stores', requireAuth, getMyStores);

// Cada usuario solo puede consultar/actualizar la tienda activa.
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

// Cierre automático de cajas (solo ADMIN/GERENTE)
router.get(
  '/current/auto-close',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  getAutoCloseConfig
);
router.patch(
  '/current/auto-close',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(autoCloseConfigSchema),
  updateAutoCloseConfig
);

// ── Parameterized routes AFTER /current ──

// ADMIN global: listado completo de tiendas.
router.get('/', requireAuth, requireRole(Role.ADMIN), listAllStores);

// ADMIN global: crear tienda.
router.post('/', requireAuth, requireRole(Role.ADMIN), validate(createStoreSchema), createStore);

// ADMIN global: editar cualquier tienda por id.
router.patch(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN),
  validate(storeUpdateSchema),
  updateStoreById
);

// ADMIN global: desactivar tienda (soft delete).
router.delete('/:id', requireAuth, requireRole(Role.ADMIN), deleteStore);

// ADMIN global: reactivar tienda.
router.patch('/:id/reactivate', requireAuth, requireRole(Role.ADMIN), reactivateStore);

export default router;
