import { Router } from 'express';
import {
  createCotizacion,
  listCotizaciones,
  getCotizacion,
  updateCotizacion,
  updateCotizacionStatus,
  convertToSale,
  deleteCotizacion,
} from '../controllers/cotizacion.controller';
import {
  cotizacionSchema,
  cotizacionStatusSchema,
  cotizacionQuerySchema,
  idParamSchema,
} from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

// Static routes BEFORE /:id
router.get('/', requireAuth, validate(cotizacionQuerySchema, 'query'), listCotizaciones);
router.post(
  '/',
  requireAuth,
  requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN),
  validate(cotizacionSchema),
  createCotizacion
);

router.get('/:id', requireAuth, validate(idParamSchema, 'params'), getCotizacion);
router.patch(
  '/:id',
  requireAuth,
  requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  validate(cotizacionSchema.partial()),
  updateCotizacion
);
router.patch(
  '/:id/status',
  requireAuth,
  requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  validate(cotizacionStatusSchema),
  updateCotizacionStatus
);
router.post(
  '/:id/convert',
  requireAuth,
  requireRole(Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  convertToSale
);
router.delete(
  '/:id',
  requireAuth,
  requireRole(Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  deleteCotizacion
);

export default router;
