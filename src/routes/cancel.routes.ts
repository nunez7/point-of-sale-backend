import { Router } from 'express';
import {
  lookupEntity,
  confirmCancellation,
  listCancellations,
} from '../controllers/cancel.controller';
import { cancelEntitySchema, cancelConfirmSchema, cancelationsQuerySchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

// Todos los endpoints requieren rol ADMIN
router.use(requireAuth, requireRole(Role.ADMIN));

// Buscar entidad por tipo y código
router.get('/lookup', validate(cancelEntitySchema, 'query'), lookupEntity);

// Confirmar cancelación
router.post('/', validate(cancelConfirmSchema), confirmCancellation);

// Listar cancelaciones (reporte)
router.get('/', validate(cancelationsQuerySchema, 'query'), listCancellations);

export default router;
