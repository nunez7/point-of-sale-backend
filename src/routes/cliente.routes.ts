import { Router } from 'express';
import {
  listarClientes,
  obtenerCliente,
  crearCliente,
  actualizarCliente,
  eliminarCliente,
} from '../controllers/cliente.controller';
import { clienteSchema, clienteUpdateSchema, clienteQuerySchema, idParamSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

// El registro de clientes es parte del flujo de facturación en caja,
// por lo que cualquier rol puede crearlo/editarlo; eliminar queda
// reservado a GERENTE/ADMIN.
router.get('/', requireAuth, validate(clienteQuerySchema, 'query'), listarClientes);
router.get('/:id', requireAuth, validate(idParamSchema, 'params'), obtenerCliente);
router.post(
  '/',
  requireAuth,
  requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN),
  validate(clienteSchema),
  crearCliente
);
router.patch(
  '/:id',
  requireAuth,
  requireRole(Role.VENDEDOR, Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  validate(clienteUpdateSchema),
  actualizarCliente
);
router.delete(
  '/:id',
  requireAuth,
  requireRole(Role.GERENTE, Role.ADMIN),
  validate(idParamSchema, 'params'),
  eliminarCliente
);

export default router;
