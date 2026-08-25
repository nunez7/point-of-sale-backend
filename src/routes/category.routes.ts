import { Router } from 'express';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/category.controller';
import { categorySchema, categoryUpdateSchema, idParamSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

router.get('/', requireAuth, listCategories);
router.post(
  '/',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(categorySchema),
  createCategory
);
router.patch(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  validate(categoryUpdateSchema),
  updateCategory
);
router.delete(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN),
  validate(idParamSchema, 'params'),
  deleteCategory
);

export default router;
