import { Role, PaymentMethod } from '../../generated/prisma/client.js';
import { Request } from 'express';

export interface JwtPayload {
  userId: string;
  storeId: string;
  role: Role;
  email: string;
  name: string;
  isActive: boolean;
  stores: { storeId: string; role: Role }[];
}

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  storeId: string;
  stores: { storeId: string; role: Role }[];
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

export interface SupplierTxLotInput {
  quantity: number;
  // Fecha de caducidad del lote (YYYY-MM-DD). null = sin caducidad.
  expirationDate?: string | null;
  lotCode?: string | null;
  // Costo unitario propio del lote; si se omite se usa el costo de la línea.
  unitCost?: number;
}

export interface SupplierTxItemInput {
  productId: string;
  quantity: number;
  unitCost: number;
  marginPct?: number;
  sellingPrice?: number;
  // Desglose en lotes. Si se omite, la cantidad completa entra como un solo
  // lote sin caducidad. Si se envía, la suma debe igualar `quantity`.
  lots?: SupplierTxLotInput[];
}

export const ROLE_HIERARCHY: Record<Role, number> = {
  VENDEDOR: 1,
  GERENTE: 2,
  ADMIN: 3,
  SOPORTE: 3,
};

export type { Role, PaymentMethod };