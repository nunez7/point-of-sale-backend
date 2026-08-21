import { Router } from 'express';
import {
  dailyReport,
  monthlyReport,
  productsReport,
  profitMarginReport,
  suppliersReport,
} from '../controllers/report.controller';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';

const router = Router();

router.use(requireAuth, requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN));

router.get('/daily', dailyReport);
router.get('/monthly', monthlyReport);
router.get('/products', productsReport);
router.get('/profit-margin', profitMarginReport);
router.get('/suppliers', suppliersReport);

export default router;