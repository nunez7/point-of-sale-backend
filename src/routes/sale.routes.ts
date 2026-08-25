import { Router } from 'express';
import { createSale, listSales, getSale, cancelSale, lookupSale } from '../controllers/sale.controller';
import { saleSchema, saleQuerySchema, idParamSchema, saleLookupSchema } from '../schemas';
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
router.get('/:id', requireAuth, validate(idParamSchema, 'params'), getSale);
router.patch(
  '/:id/cancel',
  requireAuth,
  requireRole(Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  cancelSale
);
router.get('/lookup', requireAuth, validate(saleLookupSchema, 'query'), lookupSale);

export default router;