import { Prisma } from '../../generated/prisma/client.js';

/**
 * Builders de datos para las pruebas.
 *
 * Devuelven filas con la forma que los servicios esperan de Prisma (incluyendo
 * `Decimal` real, no números), con ids deterministas ("store-1", "product-2")
 * para que los diffs de las aserciones sean legibles.
 */

export const dec = (valor: number | string): Prisma.Decimal => new Prisma.Decimal(valor);

const contadores = new Map<string, number>();

/** Genera ids deterministas por prefijo: `id('product')` → "product-1", "product-2"... */
export function id(prefijo: string): string {
  const siguiente = (contadores.get(prefijo) ?? 0) + 1;
  contadores.set(prefijo, siguiente);
  return `${prefijo}-${siguiente}`;
}

/** Reinicia los contadores (lo llama tests/setup.ts entre pruebas). */
export function resetFixtureIds(): void {
  contadores.clear();
}

const AHORA = new Date('2026-01-15T18:00:00.000Z');

export interface StoreRow {
  id: string;
  name: string;
  code: string;
  address: string | null;
  representante: string | null;
  phone: string | null;
  rfc: string | null;
  regimenFiscal: string | null;
  codigoPostal: string | null;
  saleSequence: number;
  facturaSequence: number;
  purchaseSequence: number;
  ticketSequence: number;
  cotizacionSequence: number;
  notifyOutOfStock: boolean;
  notifyLowStock: boolean;
  controlCajas: boolean;
  aperturaCajaConInventario: boolean;
  autoCloseEnabled: boolean;
  autoCloseTime: string | null;
  autoCloseDays: string[];
  umbralAlertaEfectivo: Prisma.Decimal | null;
  umbralAlertaTarjeta: Prisma.Decimal | null;
  umbralAlertaEgresos: Prisma.Decimal | null;
  diasLimiteDevolucion: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function storeFixture(overrides: Partial<StoreRow> = {}): StoreRow {
  return {
    id: overrides.id ?? id('store'),
    name: 'Abarrotes Servicaja',
    code: 'STORE001',
    address: 'Calle Juárez 123',
    representante: null,
    phone: null,
    rfc: null,
    regimenFiscal: null,
    codigoPostal: null,
    saleSequence: 0,
    facturaSequence: 0,
    purchaseSequence: 0,
    ticketSequence: 0,
    cotizacionSequence: 0,
    notifyOutOfStock: true,
    notifyLowStock: true,
    controlCajas: false,
    aperturaCajaConInventario: true,
    autoCloseEnabled: false,
    autoCloseTime: null,
    autoCloseDays: ['1', '2', '3', '4', '5', '6'],
    umbralAlertaEfectivo: null,
    umbralAlertaTarjeta: null,
    umbralAlertaEgresos: null,
    diasLimiteDevolucion: 7,
    isActive: true,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };
}

export interface UserRow {
  id: string;
  email: string;
  password: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function userFixture(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: overrides.id ?? id('user'),
    email: 'vendedor@servicaja.com',
    password: 'hash-bcrypt',
    name: 'Vendedor de Prueba',
    role: 'VENDEDOR',
    isActive: true,
    lastLoginAt: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };
}

export interface UserStoreRow {
  id: string;
  userId: string;
  storeId: string;
  role: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function userStoreFixture(overrides: Partial<UserStoreRow> = {}): UserStoreRow {
  return {
    id: overrides.id ?? id('userstore'),
    userId: 'user-1',
    storeId: 'store-1',
    role: 'VENDEDOR',
    isPrimary: true,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };
}

export interface CategoryRow {
  id: string;
  name: string;
  storeId: string;
  createdAt: Date;
}

export function categoryFixture(overrides: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: overrides.id ?? id('category'),
    name: 'Abarrotes',
    storeId: 'store-1',
    createdAt: AHORA,
    ...overrides,
  };
}

export interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  presentacion: string | null;
  imageUrl: string | null;
  unidadVenta: string;
  categoryId: string | null;
  storeId: string;
  costPrice: Prisma.Decimal;
  sellingPrice: Prisma.Decimal;
  sortOrder: number;
  isActive: boolean;
  expirationDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function productFixture(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: overrides.id ?? id('product'),
    name: 'Refresco 600ml',
    sku: 'SKU-001',
    description: null,
    presentacion: null,
    imageUrl: null,
    unidadVenta: 'UNIDAD',
    categoryId: null,
    storeId: 'store-1',
    costPrice: dec('10.00'),
    sellingPrice: dec('15.00'),
    sortOrder: 0,
    isActive: true,
    expirationDate: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };
}

export interface InventoryRow {
  id: string;
  storeId: string;
  productId: string;
  quantity: Prisma.Decimal;
  lowStockThreshold: number;
}

export function inventoryFixture(overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    id: overrides.id ?? id('inventory'),
    storeId: 'store-1',
    productId: 'product-1',
    quantity: dec('10.000'),
    lowStockThreshold: 5,
    ...overrides,
  };
}

export interface InventoryLotRow {
  id: string;
  storeId: string;
  productId: string;
  lotCode: string | null;
  expirationDate: Date | null;
  receivedQty: Prisma.Decimal;
  availableQty: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  supplierTransactionItemId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export function inventoryLotFixture(
  overrides: Partial<InventoryLotRow> = {}
): InventoryLotRow {
  return {
    id: overrides.id ?? id('lot'),
    storeId: 'store-1',
    productId: 'product-1',
    lotCode: null,
    expirationDate: null,
    receivedQty: dec('10.000'),
    availableQty: dec('10.000'),
    unitCost: dec('10.00'),
    supplierTransactionItemId: null,
    status: 'ACTIVE',
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };
}

export interface SaleRow {
  id: string;
  saleNumber: string;
  storeId: string;
  userId: string;
  total: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  profit: Prisma.Decimal;
  profitMargin: Prisma.Decimal;
  paymentMethod: string;
  received: Prisma.Decimal | null;
  change: Prisma.Decimal | null;
  status: string;
  clienteId: string | null;
  notes: string | null;
  cajaSessionId: string | null;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  canceledAt: Date | null;
  canceledBy: string | null;
  cancellationReasonId: string | null;
  cancellationComment: string | null;
  createdAt: Date;
}

export function saleFixture(overrides: Partial<SaleRow> = {}): SaleRow {
  return {
    id: overrides.id ?? id('sale'),
    saleNumber: 'STORE001-0001',
    storeId: 'store-1',
    userId: 'user-1',
    total: dec('100.00'),
    subtotal: dec('100.00'),
    discount: dec('0.00'),
    profit: dec('30.00'),
    profitMargin: dec('30.00'),
    paymentMethod: 'CASH',
    received: null,
    change: null,
    status: 'COMPLETED',
    clienteId: null,
    notes: null,
    cajaSessionId: null,
    confirmedAt: null,
    confirmedBy: null,
    canceledAt: null,
    canceledBy: null,
    cancellationReasonId: null,
    cancellationComment: null,
    createdAt: AHORA,
    ...overrides,
  };
}

export interface SaleItemRow {
  id: string;
  saleId: string;
  productId: string;
  quantity: Prisma.Decimal;
  unidad: string | null;
  unitPrice: Prisma.Decimal;
  originalUnitPrice: Prisma.Decimal | null;
  costPrice: Prisma.Decimal;
  profit: Prisma.Decimal;
  canceledAt: Date | null;
  canceledBy: string | null;
  cancellationId: string | null;
}

export function saleItemFixture(overrides: Partial<SaleItemRow> = {}): SaleItemRow {
  return {
    id: overrides.id ?? id('saleitem'),
    saleId: 'sale-1',
    productId: 'product-1',
    quantity: dec('2.000'),
    unidad: 'u',
    unitPrice: dec('15.00'),
    originalUnitPrice: null,
    costPrice: dec('10.00'),
    profit: dec('10.00'),
    canceledAt: null,
    canceledBy: null,
    cancellationId: null,
    ...overrides,
  };
}

export interface CajaRow {
  id: string;
  storeId: string;
  name: string;
  assignedUserId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function cajaFixture(overrides: Partial<CajaRow> = {}): CajaRow {
  return {
    id: overrides.id ?? id('caja'),
    storeId: 'store-1',
    name: 'Caja 1',
    assignedUserId: null,
    isActive: true,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };
}

export interface CajaSessionRow {
  id: string;
  storeId: string;
  cajaId: string;
  userId: string;
  status: string;
  openedAt: Date;
  openingDate: string | null;
  openingCash: Prisma.Decimal;
  openingElectronic: Prisma.Decimal;
  openingNote: string | null;
  inventoryAdjusted: boolean | null;
  closedAt: Date | null;
  closingDate: string | null;
  closedBy: string | null;
  closingCash: Prisma.Decimal | null;
  closingElectronic: Prisma.Decimal | null;
  closingNote: string | null;
  closingAmounts: Prisma.JsonValue | null;
  expectedAmounts: Prisma.JsonValue | null;
  diffByMethod: Prisma.JsonValue | null;
  salesCash: Prisma.Decimal | null;
  salesElectronic: Prisma.Decimal | null;
  purchasesCash: Prisma.Decimal | null;
  purchasesElectronic: Prisma.Decimal | null;
  expectedCash: Prisma.Decimal | null;
  expectedElectronic: Prisma.Decimal | null;
  diffCash: Prisma.Decimal | null;
  diffElectronic: Prisma.Decimal | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
  reopenReason: string | null;
}

export function cajaSessionFixture(
  overrides: Partial<CajaSessionRow> = {}
): CajaSessionRow {
  return {
    id: overrides.id ?? id('cajasession'),
    storeId: 'store-1',
    cajaId: 'caja-1',
    userId: 'user-1',
    status: 'OPEN',
    openedAt: AHORA,
    openingDate: '2026-01-15',
    openingCash: dec('500.00'),
    openingElectronic: dec('0.00'),
    openingNote: null,
    inventoryAdjusted: null,
    closedAt: null,
    closingDate: null,
    closedBy: null,
    closingCash: null,
    closingElectronic: null,
    closingNote: null,
    closingAmounts: null,
    expectedAmounts: null,
    diffByMethod: null,
    salesCash: null,
    salesElectronic: null,
    purchasesCash: null,
    purchasesElectronic: null,
    expectedCash: null,
    expectedElectronic: null,
    diffCash: null,
    diffElectronic: null,
    reopenedAt: null,
    reopenedBy: null,
    reopenReason: null,
    ...overrides,
  };
}

export interface ClienteRow {
  id: string;
  storeId: string;
  rfc: string;
  nombreRazonSocial: string;
  representanteLegal: string | null;
  codigoPostal: string;
  regimenFiscal: string;
  usoCfdi: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function clienteFixture(overrides: Partial<ClienteRow> = {}): ClienteRow {
  return {
    id: overrides.id ?? id('cliente'),
    storeId: 'store-1',
    rfc: 'XAXX010101000',
    nombreRazonSocial: 'Público en General',
    representanteLegal: null,
    codigoPostal: '81200',
    regimenFiscal: '601',
    usoCfdi: 'G01',
    email: null,
    phone: null,
    isActive: true,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };
}

export interface SupplierRow {
  id: string;
  name: string;
  rfc: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  storeId: string;
  createdAt: Date;
  updatedAt: Date;
}

export function supplierFixture(overrides: Partial<SupplierRow> = {}): SupplierRow {
  return {
    id: overrides.id ?? id('supplier'),
    name: 'Distribuidora del Norte',
    rfc: null,
    phone: null,
    email: null,
    address: null,
    city: null,
    state: null,
    postalCode: null,
    storeId: 'store-1',
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };
}
