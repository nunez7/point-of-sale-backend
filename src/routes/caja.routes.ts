import { Router } from 'express';
import {
  listCajas,
  createCaja,
  updateCaja,
  deleteCaja,
} from '../controllers/caja.controller';
import {
  openCaja,
  closeCaja,
  reopenCaja,
  getActiveSession,
  listSessions,
  getSessionReport,
  getSessionPreview,
} from '../controllers/cajaSession.controller';
import {
  crearMovimiento,
  listarMovimientos,
} from '../controllers/cajaMovimiento.controller';
import {
  idParamSchema,
  cajaSchema,
  cajaUpdateSchema,
  cajaOpenSchema,
  cajaCloseSchema,
  cajaMovimientoSchema,
  cajaReopenSchema,
  cajaSessionQuerySchema,
} from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

// ---------- Gestión de cajas (solo ADMIN/GERENTE) ----------
router.get('/', requireAuth, listCajas);
router.post(
  '/',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(cajaSchema),
  createCaja
);
router.patch(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  validate(cajaUpdateSchema),
  updateCaja
);
router.delete(
  '/:id',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  deleteCaja
);

// ---------- Apertura / cierre de caja (cualquier usuario autenticado) ----------
// Sesión abierta del usuario actual (caja asignada u operada).
router.get('/sessions/active', requireAuth, getActiveSession);
router.post(
  '/:id/open',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  validate(cajaOpenSchema),
  openCaja
);
router.post(
  '/sessions/:id/close',
  requireAuth,
  validate(idParamSchema, 'params'),
  validate(cajaCloseSchema),
  closeCaja
);
router.post(
  '/sessions/:id/reopen',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  validate(cajaReopenSchema),
  reopenCaja
);
router.get(
  '/sessions',
  requireAuth,
  validate(cajaSessionQuerySchema, 'query'),
  listSessions
);
router.get(
  '/sessions/:id/expected',
  requireAuth,
  validate(idParamSchema, 'params'),
  getSessionPreview
);
router.get(
  '/sessions/:id/report',
  requireAuth,
  validate(idParamSchema, 'params'),
  getSessionReport
);
router.get(
  '/sessions/:id/movimientos',
  requireAuth,
  validate(idParamSchema, 'params'),
  listarMovimientos
);
router.post(
  '/sessions/:id/movimientos',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  validate(cajaMovimientoSchema),
  crearMovimiento
);

export default router;
