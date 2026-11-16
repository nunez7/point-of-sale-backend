import { Router } from 'express';
import {
  createMovement,
  createMovementBatch,
  listMovements,
  cancelMovement,
  registerOpening,
  getOpening,
  getInventoryReport,
} from '../controllers/stockMovement.controller';
import {
  listReasons,
  createReason,
  updateReason,
  deleteReason,
} from '../controllers/movementReason.controller';
import {
  movementReasonSchema,
  movementReasonUpdateSchema,
  stockMovementSchema,
  stockMovementBatchSchema,
  stockMovementQuerySchema,
  cancelMovementSchema,
  inventoryOpeningQuerySchema,
  idParamSchema,
} from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';
import { listLots, getExpiringLots, getLotsBalance } from '../controllers/lot.controller';

const router = Router();

// ---------- Motivos de movimiento (solo ADMIN/GERENTE) ----------
router.get(
  '/movement-reasons',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  listReasons
);
router.post(
  '/movement-reasons',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(movementReasonSchema),
  createReason
);
router.patch(
  '/movement-reasons/:id',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  validate(movementReasonUpdateSchema),
  updateReason
);
router.delete(
  '/movement-reasons/:id',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  deleteReason
);

// ---------- Lotes y caducidades ----------
// Las rutas estáticas van antes de cualquier `/:id`.
router.get('/lots/por-vencer', requireAuth, getExpiringLots);
router.get('/lots/cuadre', requireAuth, requireRole(Role.ADMIN, Role.GERENTE), getLotsBalance);
router.get('/lots', requireAuth, listLots);

// ---------- Movimientos de inventario ----------
router.get(
  '/movements',
  requireAuth,
  validate(stockMovementQuerySchema, 'query'),
  listMovements
);
router.post(
  '/movements',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(stockMovementSchema),
  createMovement
);
router.post(
  '/movements/batch',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(stockMovementBatchSchema),
  createMovementBatch
);
router.post(
  '/movements/:id/cancel',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  validate(cancelMovementSchema),
  cancelMovement
);

// ---------- Apertura y reporte de inventario ----------
router.get(
  '/opening',
  requireAuth,
  validate(inventoryOpeningQuerySchema, 'query'),
  getOpening
);
router.post(
  '/opening',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  registerOpening
);
router.get(
  '/report',
  requireAuth,
  validate(inventoryOpeningQuerySchema, 'query'),
  getInventoryReport
);

export default router;
