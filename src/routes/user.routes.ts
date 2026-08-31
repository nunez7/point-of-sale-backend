import { Router } from 'express';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  setUserStores,
} from '../controllers/user.controller';
import { createUserSchema, updateUserSchema, setUserStoresSchema, idParamSchema } from '../schemas';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { Role } from '../../generated/prisma/client.js';

const router = Router();

router.use(requireAuth, requireRole(Role.ADMIN));

router.get('/', listUsers);
router.post('/', validate(createUserSchema), createUser);
router.patch('/:id/stores', validate(idParamSchema, 'params'), validate(setUserStoresSchema), setUserStores);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateUserSchema), updateUser);
router.delete('/:id', validate(idParamSchema, 'params'), deleteUser);

export default router;