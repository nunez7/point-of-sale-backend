import { z } from 'zod';
import { PaymentMethod, Role, UnidadVenta, MovementTipo } from '../../generated/prisma/client.js';

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

// Cantidad para productos a granel: admite hasta 3 decimales (gramos/ml).
const cantidadPositiva = z
  .number()
  .positive('Cantidad debe ser mayor a 0')
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, {
    message: 'La cantidad admite máximo 3 decimales',
  });

export const productSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  sku: z.string().optional().nullable(),
  description: z.string().max(500, 'Máximo 500 caracteres').optional().nullable(),
  presentacion: z
    .string()
    .trim()
    .min(1, 'La presentación no puede estar vacía')
    .max(50, 'Máximo 50 caracteres')
    .optional()
    .nullable(),
  unidadVenta: z.nativeEnum(UnidadVenta).default(UnidadVenta.UNIDAD),
  categoryId: z.string().optional().nullable(),
  storeId: z.string().min(1),
  costPrice: positiveDecimal,
  sellingPrice: positiveDecimal,
  sortOrder: z.number().int().min(0).optional(),
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
  quantity: cantidadPositiva,
  unitPrice: positiveDecimal,
});

export const saleSchema = z.object({
  items: z.array(saleItemSchema).min(1, 'Debe haber al menos un item'),
  paymentMethod: paymentMethodSchema,
  discount: z.number().min(0, 'El descuento no puede ser negativo').max(100, 'El descuento no puede ser mayor a 100%').default(0),
  storeId: z.string().min(1),
  // COMPLETED = venta inmediata (descuenta inventario); PENDING = pedido
  // (no descuenta inventario hasta confirmarse).
  status: z.enum(['COMPLETED', 'PENDING']).default('COMPLETED'),
  // Pedido: cliente asociado (opcional) y notas libres.
  clienteId: z.string().nullable().optional(),
  notes: z.string().max(500, 'Máximo 500 caracteres').nullable().optional(),
});

export const saleQuerySchema = z.object({
  storeId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// Listado de pedidos: filtra por estado (PENDING por defecto) y rango de fechas.
export const orderQuerySchema = z.object({
  storeId: z.string().min(1, 'El identificador de la tienda es requerido'),
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELED', 'ALL']).default('PENDING'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha inicial debe tener formato YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha final debe tener formato YYYY-MM-DD')
    .optional(),
});

export const supplierSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  rfc: z
    .string()
    .trim()
    .max(13)
    .optional()
    .nullable()
    .refine(
      (v) => !v || /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{2}[0-9A]$/i.test(v),
      'RFC inválido (formato: XXXX010101XXX)'
    ),
  phone: z.string().optional().nullable(),
  email: z.string().email('Email inválido').optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(120).optional().nullable(),
  postalCode: z.string().max(10).optional().nullable(),
  storeId: z.string().min(1),
});

export const supplierUpdateSchema = supplierSchema.partial();

export const supplierTxItemSchema = z.object({
  productId: z.string().min(1),
  quantity: cantidadPositiva,
  unitCost: positiveDecimal,
  // Margen de ganancia (%) sobre el costo para sugerir el precio de venta.
  // Por defecto 16 si no se envía.
  marginPct: z.number().min(0).max(1000).optional(),
  // Precio de venta resultante. Si se omite, se calcula como
  // unitCost * (1 + marginPct/100).
  sellingPrice: positiveDecimal.optional(),
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

// ---------- Facturación (CFDI) ----------

// Catálogo c_RégimenFiscal del SAT
export const REGIMENES_FISCALES = [
  '601', '603', '605', '606', '607', '608', '610', '611', '612',
  '614', '615', '616', '620', '621', '622', '623', '624', '625', '626',
] as const;

// Catálogo c_UsoCFDI del SAT
export const USOS_CFDI = [
  'G01', 'G02', 'G03', 'I01', 'I02', 'I03', 'I04', 'I05', 'I06', 'I07',
  'I08', 'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09',
  'D10', 'CP01', 'CN01', 'S01',
] as const;

export const regimenFiscalSchema = z.enum(REGIMENES_FISCALES, {
  errorMap: () => ({ message: 'Régimen fiscal inválido' }),
});

export const usoCfdiSchema = z.enum(USOS_CFDI, {
  errorMap: () => ({ message: 'Uso del CFDI inválido' }),
});

export const rfcSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{2}[0-9A]$/, 'RFC inválido (formato: XXXX010101XXX)');

export const codigoPostalSchema = z
  .string()
  .trim()
  .regex(/^\d{5}$/, 'El código postal debe tener 5 dígitos');

export const clienteSchema = z.object({
  rfc: rfcSchema,
  nombreRazonSocial: z
    .string()
    .trim()
    .min(1, 'El nombre o razón social es requerido')
    .max(255, 'Máximo 255 caracteres'),
  representanteLegal: z
    .string()
    .trim()
    .max(255, 'Máximo 255 caracteres')
    .optional()
    .nullable(),
  codigoPostal: codigoPostalSchema,
  regimenFiscal: regimenFiscalSchema,
  usoCfdi: usoCfdiSchema.optional().nullable(),
  email: z.string().email('Email inválido').optional().nullable(),
  phone: z.string().max(30, 'Máximo 30 caracteres').optional().nullable(),
});

export const clienteUpdateSchema = clienteSchema
  .partial()
  .extend({ isActive: z.boolean() })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });

export const clienteQuerySchema = z.object({
  search: z.string().optional(),
  includeInactive: z.string().optional(),
});

export const facturaCreateSchema = z
  .object({
    ventaId: z.string().min(1).optional(),
    saleNumber: z.string().min(1).optional(),
    clienteId: z.string().min(1, 'Debes seleccionar o registrar un cliente'),
    // Por defecto, gastos en general
    usoCfdi: usoCfdiSchema.default('G03'),
  })
  .refine((d) => Boolean(d.ventaId || d.saleNumber), {
    message: 'Debe indicar la venta a facturar',
  });

export const storeUpdateSchema = z
  .object({
    name: z.string().min(1, 'El nombre es requerido').optional(),
    code: z.string().min(1, 'El código de tienda es requerido').optional(),
    address: z.string().max(255, 'Máximo 255 caracteres').optional().nullable(),
    representante: z.string().max(120, 'Máximo 120 caracteres').optional().nullable(),
    phone: z.string().max(30, 'Máximo 30 caracteres').optional().nullable(),
    rfc: rfcSchema.optional().nullable(),
    regimenFiscal: regimenFiscalSchema.optional().nullable(),
    codigoPostal: codigoPostalSchema.optional().nullable(),
    notifyOutOfStock: z.boolean().optional(),
    notifyLowStock: z.boolean().optional(),
    controlCajas: z.boolean().optional(),
    aperturaCajaConInventario: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });

// Datos fiscales del emisor; cualquier usuario autenticado puede
// completarlos desde el formulario de facturación.
export const storeFiscalesSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre o razón social es requerido').max(255).optional(),
    rfc: rfcSchema.optional(),
    regimenFiscal: regimenFiscalSchema.optional(),
    codigoPostal: codigoPostalSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });

export const updatePerfilSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  email: z.string().email('Email inválido'),
});

export const verifyPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'La contraseña actual es requerida'),
});

export const authorizeCajaCloseSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
});

export const cambiarPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'La contraseña actual es requerida'),
  newPassword: z.string().min(6, 'La nueva contraseña debe tener mínimo 6 caracteres'),
});

export const dailyReportSchema = z.object({
  storeId: z.string().min(1),
  date: z.string().optional(),
});

export const monthlyReportSchema = z.object({
  storeId: z.string().min(1),
  month: z.string().optional(),
});

// Buscar venta por número de ticket
export const saleLookupSchema = z.object({
  saleNumber: z.string().trim().toUpperCase(),
});

// El corte de caja toma la tienda del token; acepta un día (date) o un rango (startDate/endDate).
export const corteCajaQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD')
    .optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha inicial debe tener formato YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha final debe tener formato YYYY-MM-DD')
    .optional(),
  operator: z.string().optional(),
});

export const facturaQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha inicial debe tener formato YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha final debe tener formato YYYY-MM-DD')
    .optional(),
  status: z.enum(['EMITIDA', 'CANCELADA']).optional(),
});

// ---------- Cancelaciones ----------

export const cancelEntitySchema = z.object({
  entityType: z.enum(['SALE', 'FACTURA', 'SUPPLIER_TRANSACTION'], {
    errorMap: () => ({ message: 'Tipo de entidad inválido. Use: SALE, FACTURA o SUPPLIER_TRANSACTION' }),
  }),
  entityCode: z.string().min(1, 'El código o número del documento es requerido'),
});

export const cancelConfirmSchema = z.object({
  entityType: z.enum(['SALE', 'FACTURA', 'SUPPLIER_TRANSACTION'], {
    errorMap: () => ({ message: 'Tipo de entidad inválido. Use: SALE, FACTURA o SUPPLIER_TRANSACTION' }),
  }),
  entityId: z.string().min(1, 'El ID del documento es requerido'),
  cancellationReasonId: z.string().min(1, 'El motivo de cancelación es requerido'),
  comment: z
    .string()
    .max(500, 'Máximo 500 caracteres')
    .optional()
    .nullable(),
  // Cancelación parcial (solo SALE): lista de artículos con la cantidad a cancelar.
  items: z
    .array(
      z.object({
        saleItemId: z.string().min(1, 'El artículo es requerido'),
        quantity: z.number().positive('La cantidad debe ser mayor a 0'),
      })
    )
    .min(1, 'Debe incluir al menos un artículo')
    .optional(),
});

export const cancelationsQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha inicial debe tener formato YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha final debe tener formato YYYY-MM-DD')
    .optional(),
  entityType: z.enum(['SALE', 'FACTURA', 'SUPPLIER_TRANSACTION']).optional(),
  cancellationReasonId: z.string().optional(),
  type: z.enum(['FULL', 'PARTIAL']).optional(),
});

// ---------- Motivos de movimiento de inventario ----------

export const movementReasonSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(80, 'Máximo 80 caracteres'),
  tipo: z.nativeEnum(MovementTipo, {
    errorMap: () => ({ message: 'Tipo de movimiento inválido' }),
  }),
  departamento: z.string().max(50, 'Máximo 50 caracteres').optional().nullable(),
  isActive: z.boolean().optional(),
});

export const movementReasonUpdateSchema = movementReasonSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });

// ---------- Motivos de cancelación (editables) ----------

export const cancellationReasonSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(80, 'Máximo 80 caracteres'),
  isActive: z.boolean().optional(),
});

export const cancellationReasonUpdateSchema = cancellationReasonSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });

// ---------- Movimientos de inventario ----------

export const stockMovementSchema = z.object({
  productId: z.string().min(1, 'El producto es requerido'),
  reasonId: z.string().min(1, 'El motivo es requerido'),
  quantity: cantidadPositiva,
  comment: z.string().max(500, 'Máximo 500 caracteres').optional().nullable(),
});

export const stockMovementBatchItemSchema = z.object({
  productId: z.string().min(1, 'El producto es requerido'),
  quantity: cantidadPositiva,
  comment: z.string().max(500, 'Máximo 500 caracteres').optional().nullable(),
});

export const stockMovementBatchSchema = z.object({
  reasonId: z.string().min(1, 'El motivo es requerido'),
  comment: z.string().max(500, 'Máximo 500 caracteres').optional().nullable(),
  items: z
    .array(stockMovementBatchItemSchema)
    .min(1, 'Debe incluir al menos un producto'),
});

export const stockMovementQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha inicial debe tener formato YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha final debe tener formato YYYY-MM-DD')
    .optional(),
  productId: z.string().optional(),
  tipo: z.nativeEnum(MovementTipo).optional(),
  reasonId: z.string().optional(),
  status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
});

export const cancelMovementSchema = z.object({
  cancellationReason: z.string().min(1, 'El motivo de anulación es requerido').max(100),
  cancellationComment: z
    .string()
    .max(500, 'Máximo 500 caracteres')
    .optional()
    .nullable(),
});

export const inventoryOpeningQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD')
    .optional(),
});

export const inventoryQuerySchema = z.object({
  search: z.string().max(80, 'Máximo 80 caracteres').optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
  sortBy: z.enum(['name', 'category', 'quantity', 'lowStockThreshold']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// ---------- Cajas ----------
export const cajaSchema = z.object({
  name: z.string().min(1, 'El nombre de la caja es requerido').max(60, 'Máximo 60 caracteres'),
  assignedUserId: z.string().min(1).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const cajaUpdateSchema = cajaSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'Debe enviar al menos un campo a actualizar' }
);

export const cajaOpenSchema = z.object({
  openingCash: z.number().min(0, 'El efectivo inicial no puede ser negativo').default(0),
  openingElectronic: z.number().min(0, 'El saldo electrónico inicial no puede ser negativo').default(0),
  openingNote: z.string().max(500, 'Máximo 500 caracteres').optional().nullable(),
});

export const cajaCloseSchema = z.object({
  closingCash: z.number().min(0, 'El efectivo declarado no puede ser negativo'),
  closingElectronic: z.number().min(0, 'El saldo electrónico declarado no puede ser negativo'),
  closingNote: z.string().max(500, 'Máximo 500 caracteres').optional().nullable(),
  authorizationToken: z.string().optional(),
});

export const cajaSessionQuerySchema = z.object({
  cajaId: z.string().optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha inicial debe tener formato YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha final debe tener formato YYYY-MM-DD')
    .optional(),
});

export const cajaMovimientoSchema = z.object({
  tipo: z.enum(['INGRESO', 'EGRESO'], {
    errorMap: () => ({ message: 'El tipo debe ser INGRESO o EGRESO' }),
  }),
  metodo: z.enum(['CASH', 'ELECTRONIC']).default('CASH'),
  monto: z.number().positive('El monto debe ser mayor a cero'),
  motivo: z.string().min(1, 'El motivo es requerido').max(500, 'Máximo 500 caracteres'),
});

export const cajaReopenSchema = z.object({
  motivo: z.string().min(1, 'El motivo de reapertura es requerido').max(500, 'Máximo 500 caracteres'),
});

export const cierreCajaQuerySchema = z.object({
  cajaId: z.string().optional(),
  userId: z.string().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha inicial debe tener formato YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha final debe tener formato YYYY-MM-DD')
    .optional(),
});