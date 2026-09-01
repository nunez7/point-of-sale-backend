import { Router } from 'express';
import {
  listPromotions,
  getPromotion,
  createPromotion,
  updatePromotion,
  togglePromotion,
  deletePromotion,
  getApplicable,
  previewPromotions,
  getReport,
} from '../controllers/promotion.controller';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

router.get('/', requireAuth, listPromotions);
router.get('/applicable', requireAuth, getApplicable);
router.get('/report', requireAuth, getReport);
router.get('/:id', requireAuth, getPromotion);
router.post('/', requireAuth, requireRole(Role.GERENTE, Role.ADMIN), createPromotion);
router.patch('/:id', requireAuth, requireRole(Role.GERENTE, Role.ADMIN), updatePromotion);
router.post('/:id/toggle', requireAuth, requireRole(Role.GERENTE, Role.ADMIN), togglePromotion);
router.delete('/:id', requireAuth, requireRole(Role.GERENTE, Role.ADMIN), deletePromotion);
router.post('/preview', requireAuth, previewPromotions);

export default router;
