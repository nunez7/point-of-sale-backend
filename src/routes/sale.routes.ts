import { Router } from 'express';
import { createSale, listSales, getSale, cancelSale, lookupSale, listOrders, confirmOrder, cancelOrder, holdSale, listHeldSales, retrieveHeldSale, completeHeldSale } from '../controllers/sale.controller';
import { saleSchema, saleQuerySchema, idParamSchema, saleLookupSchema, orderQuerySchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

router.post(
  '/',
  requireAuth,
  requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN),
  validate(saleSchema),
  createSale
);
router.get('/', requireAuth, validate(saleQuerySchema, 'query'), listSales);
// Rutas estáticas ANTES de /:id para evitar que el parámetro las capture.
router.get('/orders', requireAuth, validate(orderQuerySchema, 'query'), listOrders);
router.get('/lookup', requireAuth, validate(saleLookupSchema, 'query'), lookupSale);
router.get('/:id', requireAuth, validate(idParamSchema, 'params'), getSale);
router.patch(
  '/:id/cancel',
  requireAuth,
  requireRole(Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  cancelSale
);
router.post(
  '/:id/confirm',
  requireAuth,
  requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  confirmOrder
);
router.post(
  '/:id/cancel-order',
  requireAuth,
  requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  cancelOrder
);

// --- Rutas para ventas en espera (parked/held sales) ---

router.post(
  '/:id/hold',
  requireAuth,
  requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  holdSale
);

router.get(
  '/held',
  requireAuth,
  validate(orderQuerySchema, 'query'),
  listHeldSales
);

router.get(
  '/:id/retrieve',
  requireAuth,
  validate(idParamSchema, 'params'),
  retrieveHeldSale
);

router.post(
  '/:id/complete-held',
  requireAuth,
  requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  completeHeldSale
);

export default router;