import { Router } from 'express';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getInventory,
  getLowStock,
} from '../controllers/product.controller';
import {
  productSchema,
  productUpdateSchema,
  productQuerySchema,
  idParamSchema,
} from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';

const router = Router();

// Must be registered before /:id
router.get(
  '/inventory/:storeId',
  requireAuth,
  validate(idParamSchema, 'params'),
  getInventory
);
router.get(
  '/low-stock/:storeId',
  requireAuth,
  validate(idParamSchema, 'params'),
  getLowStock
);

router.get('/', requireAuth, validate(productQuerySchema, 'query'), listProducts);
router.get('/:id', requireAuth, validate(idParamSchema, 'params'), getProduct);

router.post(
  '/',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(productSchema),
  createProduct
);
router.patch(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  validate(productUpdateSchema),
  updateProduct
);
router.delete(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN),
  validate(idParamSchema, 'params'),
  deleteProduct
);

export default router;