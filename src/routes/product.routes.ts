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
  getStockAlerts,
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
  inventoryQuerySchema,
} from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';
import { uploadSingle } from '../config/multer';

const router = Router();

// Las rutas estáticas (inventory, low-stock, alerts, siguiente-codigo, template)
// se registran ANTES de las rutas con parámetro para que Express no las
// capture como `/:id`.

// ---------- Inventario y alertas (scopeado a la tienda del token) ----------
router.get(
  '/inventory',
  requireAuth,
  validate(inventoryQuerySchema, 'query'),
  getInventory
);
router.get('/low-stock', requireAuth, getLowStock);
router.get('/alerts', requireAuth, getStockAlerts);

// ---------- Productos ----------
router.get('/', requireAuth, validate(productQuerySchema, 'query'), listProducts);
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

export default router;
