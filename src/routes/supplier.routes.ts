import { Router } from 'express';
import {
  listSuppliers,
  createSupplier,
  updateSupplier,
  getSupplierTransactions,
  createSupplierTransaction,
  listStoreTransactions,
  getTransactionById,
} from '../controllers/supplier.controller';
import {
  supplierSchema,
  supplierUpdateSchema,
  supplierTxSchema,
  idParamSchema,
} from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';

const router = Router();

// Debe registrarse antes de /:id/transactions y /:id.
router.post(
  '/transactions',
  requireAuth,
  requireRole(Role.GERENTE, Role.ADMIN),
  validate(supplierTxSchema),
  createSupplierTransaction
);
router.get(
  '/transactions',
  requireAuth,
  listStoreTransactions
);
router.get(
  '/transactions/:id',
  requireAuth,
  getTransactionById
);

router.get('/', requireAuth, listSuppliers);
router.post(
  '/',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(supplierSchema),
  createSupplier
);
router.patch(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  validate(supplierUpdateSchema),
  updateSupplier
);
router.get(
  '/:id/transactions',
  requireAuth,
  validate(idParamSchema, 'params'),
  getSupplierTransactions
);

export default router;