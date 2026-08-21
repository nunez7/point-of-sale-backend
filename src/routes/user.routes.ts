import { Router } from 'express';
import { listUsers, createUser, updateUser, deleteUser } from '../controllers/user.controller';
import { createUserSchema, updateUserSchema, idParamSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';

const router = Router();

router.use(requireAuth, requireRole(Role.ADMIN));

router.get('/', listUsers);
router.post('/', validate(createUserSchema), createUser);
router.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateUserSchema),
  updateUser
);
router.delete('/:id', validate(idParamSchema, 'params'), deleteUser);

export default router;