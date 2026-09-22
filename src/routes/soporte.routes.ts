import { Router } from 'express';
import {
  createTicket,
  listTickets,
  getTicket,
  updateStatus,
  addComment,
  solveTicket,
  closeTicket,
  rejectTicket,
  getConfig,
  updateConfig,
} from '../controllers/soporte.controller';
import { listAuditLogs } from '../controllers/audit.controller';
import {
  createTicketSchema,
  updateTicketStatusSchema,
  addTicketCommentSchema,
  solveTicketSchema,
  closeTicketSchema,
  rejectTicketSchema,
  ticketsQuerySchema,
  ticketConfigSchema,
  auditLogsQuerySchema,
} from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

router.use(requireAuth);

// Crear ticket: cualquier usuario autenticado que no sea SOPORTE.
router.post(
  '/tickets',
  validate(createTicketSchema),
  createTicket
);

// Listar tickets: todos los roles (el servicio filtra por permisos).
router.get('/tickets', validate(ticketsQuerySchema, 'query'), listTickets);

// Detalle de ticket.
router.get('/tickets/:id', getTicket);

// Cambiar estado (solo SOPORTE).
router.patch(
  '/tickets/:id/status',
  validate(updateTicketStatusSchema),
  updateStatus
);

// Agregar comentario.
router.post(
  '/tickets/:id/comments',
  validate(addTicketCommentSchema),
  addComment
);

// Marcar como solucionado con evidencia (solo SOPORTE).
router.post(
  '/tickets/:id/solve',
  validate(solveTicketSchema),
  solveTicket
);

// Cerrar ticket (cliente valida).
router.post(
  '/tickets/:id/close',
  validate(closeTicketSchema),
  closeTicket
);

// Rechazar cierre del ticket (cliente).
router.post(
  '/tickets/:id/reject',
  validate(rejectTicketSchema),
  rejectTicket
);

// Configuración de soporte por tienda (solo ADMIN/GERENTE).
router.get('/config', getConfig);
router.patch(
  '/config',
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(ticketConfigSchema),
  updateConfig
);

// Registro de auditoría (solo ADMIN/GERENTE).
router.get(
  '/audit-logs',
  requireRole(Role.ADMIN, Role.GERENTE),
  validate(auditLogsQuerySchema, 'query'),
  listAuditLogs
);

export default router;
