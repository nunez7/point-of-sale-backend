import { Router } from 'express';
import {
  corteCaja,
  cierreCaja,
  dailyReport,
  monthlyReport,
  productsReport,
  profitMarginReport,
  suppliersReport,
} from '../controllers/report.controller';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { corteCajaQuerySchema, cierreCajaQuerySchema } from '../schemas';
import { validate } from '../middleware/validate';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

router.use(requireAuth, requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN));

router.get('/daily', dailyReport);
router.get('/corte-caja', validate(corteCajaQuerySchema, 'query'), corteCaja);
router.get('/cierre-caja', validate(cierreCajaQuerySchema, 'query'), cierreCaja);
router.get('/monthly', monthlyReport);
router.get('/products', productsReport);
router.get('/profit-margin', profitMarginReport);
router.get('/suppliers', suppliersReport);

export default router;