import { Router } from 'express';
import {
  buscarVenta,
  emitirFactura,
  listarFacturas,
  obtenerFactura,
  cancelarFactura,
} from '../controllers/factura.controller';
import { facturaCreateSchema, facturaQuerySchema, idParamSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';

const router = Router();

// La emisión se hace desde el punto de venta cuando el cliente la solicita;
// la cancelación queda reservada a GERENTE/ADMIN.
router.get('/', requireAuth, validate(facturaQuerySchema, 'query'), listarFacturas);
router.get('/venta/:numero', requireAuth, buscarVenta);
router.post(
  '/',
  requireAuth,
  requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN),
  validate(facturaCreateSchema),
  emitirFactura
);
router.get('/:id', requireAuth, validate(idParamSchema, 'params'), obtenerFactura);
router.patch(
  '/:id/cancelar',
  requireAuth,
  requireRole(Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  cancelarFactura
);

export default router;
