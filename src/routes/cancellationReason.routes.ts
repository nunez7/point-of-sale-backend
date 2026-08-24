import { Router } from 'express';
import {
  listReasons,
  createReason,
  updateReason,
  deleteReason,
} from '../controllers/cancellationReason.controller';
import { cancellationReasonSchema, cancellationReasonUpdateSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';

const router = Router();

// Todos los endpoints requieren autenticación; la edición/creación la controla
// el rol (solo ADMIN), al igual que los motivos de inventario.
router.use(requireAuth, requireRole(Role.ADMIN));

router.get('/', listReasons);
router.post('/', validate(cancellationReasonSchema), createReason);
router.patch('/:id', validate(cancellationReasonUpdateSchema), updateReason);
router.delete('/:id', deleteReason);

export default router;
