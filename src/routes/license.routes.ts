import { Router } from 'express';
import {
  getEstado,
  getInstalacion,
  activar,
  listarEventos,
  activarCaja,
  resumen,
} from '../controllers/license.controller';
import { licenciaActivarSchema, idParamSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

// Estado de la licencia de la tienda activa (cualquier usuario autenticado).
router.get('/estado', requireAuth, getEstado);

// Código de instalación y configuración del licenciamiento.
router.get(
  '/instalacion',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE, Role.SOPORTE),
  getInstalacion
);

// Canjear un código firmado. Lo puede pegar el ADMIN del cliente o SOPORTE;
// emitirlo solo es posible con la llave privada del creador.
router.post(
  '/activar',
  requireAuth,
  requireRole(Role.ADMIN, Role.SOPORTE),
  validate(licenciaActivarSchema),
  activar
);

// Historial de activaciones, renovaciones y vencimientos.
router.get(
  '/eventos',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE, Role.SOPORTE),
  listarEventos
);

// Asignar la licencia operativa a una caja.
router.post(
  '/cajas/:id',
  requireAuth,
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(idParamSchema, 'params'),
  activarCaja
);

// Panel del creador (todas las tiendas de la instalación).
router.get('/resumen', requireAuth, requireRole(Role.SOPORTE), resumen);

export default router;
