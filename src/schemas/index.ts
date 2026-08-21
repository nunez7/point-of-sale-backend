import { z } from 'zod';
import { PaymentMethod, Role } from '@prisma/client';

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
});

export const idParamSchema = z.object({
  id: z.string().min(1),
});

export const storeIdParamSchema = z.object({
  storeId: z.string().min(1, 'El identificador de la tienda es requerido'),
});

export const paymentMethodSchema = z.enum(
  Object.values(PaymentMethod) as [string, ...string[]]
);

const positiveDecimal = z.number().positive('Debe ser mayor a 0');

export const productSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  storeId: z.string().min(1),
  costPrice: positiveDecimal,
  sellingPrice: positiveDecimal,
  isActive: z.boolean().optional(),
});

export const productUpdateSchema = productSchema.partial();

export const productQuerySchema = z.object({
  storeId: z.string().optional(),
  search: z.string().optional(),
  category: z.string().optional(),
  includeInactive: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
  sortBy: z
    .enum(['name', 'category', 'sku', 'costPrice', 'sellingPrice'])
    .optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const categorySchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  storeId: z.string().min(1),
});

export const categoryUpdateSchema = categorySchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });

export const saleItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int('Cantidad debe ser entero').positive('Cantidad debe ser mayor a 0'),
  unitPrice: positiveDecimal,
});

export const saleSchema = z.object({
  items: z.array(saleItemSchema).min(1, 'Debe haber al menos un item'),
  paymentMethod: paymentMethodSchema,
  discount: z.number().min(0, 'El descuento no puede ser negativo').max(100, 'El descuento no puede ser mayor a 100%').default(0),
  storeId: z.string().min(1),
});

export const saleQuerySchema = z.object({
  storeId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const supplierSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  phone: z.string().optional().nullable(),
  email: z.string().email('Email inválido').optional().nullable(),
  address: z.string().optional().nullable(),
  storeId: z.string().min(1),
});

export const supplierUpdateSchema = supplierSchema.partial();

export const supplierTxItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCost: positiveDecimal,
});

export const supplierTxSchema = z.object({
  supplierId: z.string().min(1),
  items: z.array(supplierTxItemSchema).min(1),
  paymentMethod: paymentMethodSchema,
});

export const createUserSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  name: z.string().min(1, 'El nombre es requerido'),
  role: z.nativeEnum(Role),
  storeId: z.string().min(1),
});

export const updateUserSchema = z
  .object({
    email: z.string().email('Email inválido').optional(),
    password: z.string().min(6, 'Mínimo 6 caracteres').optional(),
    name: z.string().min(1).optional(),
    role: z.nativeEnum(Role).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });

export const storeUpdateSchema = z
  .object({
    name: z.string().min(1, 'El nombre es requerido').optional(),
    code: z.string().min(1, 'La razón social es requerida').optional(),
    address: z.string().max(255, 'Máximo 255 caracteres').optional().nullable(),
    representante: z.string().max(120, 'Máximo 120 caracteres').optional().nullable(),
    phone: z.string().max(30, 'Máximo 30 caracteres').optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });

export const dailyReportSchema = z.object({
  storeId: z.string().min(1),
  date: z.string().optional(),
});

export const monthlyReportSchema = z.object({
  storeId: z.string().min(1),
  month: z.string().optional(),
});