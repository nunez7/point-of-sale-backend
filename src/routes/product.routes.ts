import { Router } from 'express';
import {
  listProducts,
  getProduct,
  getSiguienteCodigo,
  createProduct,
  updateProduct,
  deleteProduct,
  getInventory,
  getLowStock,
} from '../controllers/product.controller';
import {
  importProducts,
  downloadProductTemplate,
} from '../controllers/productImport.controller';
import {
  productSchema,
  productUpdateSchema,
  productQuerySchema,
  idParamSchema,
  storeIdParamSchema,
} from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';
import { uploadSingle } from '../config/multer';

const router = Router();

// Must be registered before /:id
router.get(
  '/inventory/:storeId',
  requireAuth,
  validate(storeIdParamSchema, 'params'),
  getInventory
);
router.get(
  '/low-stock/:storeId',
  requireAuth,
  validate(storeIdParamSchema, 'params'),
  getLowStock
);

router.get('/', requireAuth, validate(productQuerySchema, 'query'), listProducts);
// Must be registered before /:id
router.get('/siguiente-codigo', requireAuth, getSiguienteCodigo);
router.get('/template', requireAuth, downloadProductTemplate);
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

router.post(
  '/import',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  uploadSingle('file'),
  importProducts
);

router.get(
  '/template',
  requireAuth,
  downloadProductTemplate
);

export default router;