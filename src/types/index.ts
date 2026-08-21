import { Role, PaymentMethod } from '@prisma/client';
import { Request } from 'express';

export interface JwtPayload {
  userId: string;
  storeId: string;
  role: Role;
  email: string;
}

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  storeId: string;
  isActive: boolean;
}

export interface AuthedRequest extends Request {
  user?: AuthedUser;
}

export interface SaleItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface SupplierTxItemInput {
  productId: string;
  quantity: number;
  unitCost: number;
}

export const ROLE_HIERARCHY: Record<Role, number> = {
  VENDEDOR: 1,
  GERENTE: 2,
  ADMIN: 3,
};

export type { Role, PaymentMethod };