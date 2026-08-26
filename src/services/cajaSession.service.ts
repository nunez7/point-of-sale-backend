import { prisma } from '../config/prisma';
import { Prisma, Role, PaymentMethod } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { colombiaStartOfDay, colombiaLocalDateKey } from '../utils/dates';
import { registerOpening } from './stockMovement.service';

// Métodos de pago que cuentan como "electrónico" en el corte de caja.
const ELECTRONIC_METHODS: PaymentMethod[] = [
  PaymentMethod.CARD,
  PaymentMethod.TRANSFER,
  PaymentMethod.CREDIT,
  PaymentMethod.OTHER,
];

function isElectronic(method: PaymentMethod): boolean {
  return ELECTRONIC_METHODS.includes(method);
}

export interface OpenCajaInput {
  openingCash: number;
  openingElectronic: number;
  openingNote?: string | null;
}

export interface CloseCajaInput {
  closingCash: number;
  closingElectronic: number;
  closingNote?: string | null;
}

const sessionInclude = {
  caja: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CajaSessionInclude;

// Abre una caja: crea una sesión OPEN. La misma caja no puede tener dos
// sesiones abiertas. Si la tienda usa inventario en la apertura, captura el
// snapshot del día automáticamente.
export async function openCaja(
  storeId: string,
  userId: string,
  role: string,
  cajaId: string,
  data: OpenCajaInput
) {
  const caja = await prisma.caja.findFirst({ where: { id: cajaId, storeId } });
  if (!caja) throw ApiError.notFound('Caja no encontrada', 'CAJA_NOT_FOUND');
  if (!caja.isActive) {
    throw ApiError.badRequest('La caja está inactiva', 'CAJA_INACTIVE');
  }

  // Un vendedor solo puede abrir la caja que tiene asignada.
  if (role === Role.VENDEDOR && caja.assignedUserId !== userId) {
    throw ApiError.forbidden(
      'Solo puedes abrir la caja que tienes asignada',
      'CAJA_NOT_ASSIGNED'
    );
  }

  const existing = await prisma.cajaSession.findFirst({
    where: { cajaId, storeId, status: 'OPEN' },
  });
  if (existing) {
    throw ApiError.badRequest(
      'Esta caja ya tiene una sesión abierta',
      'CAJA_YA_ABIERTA'
    );
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { aperturaCajaConInventario: true },
  });
  const adjustInventory = store?.aperturaCajaConInventario ?? false;
  if (adjustInventory) {
    await registerOpening(storeId);
  }

  const session = await prisma.cajaSession.create({
    data: {
      storeId,
      cajaId,
      userId,
      openingCash: new Prisma.Decimal(data.openingCash),
      openingElectronic: new Prisma.Decimal(data.openingElectronic),
      openingNote: data.openingNote ?? null,
      inventoryAdjusted: adjustInventory,
      status: 'OPEN',
    },
    include: sessionInclude,
  });

  await audit({
    storeId,
    userId,
    action: 'OPEN_CAJA',
    entity: 'CajaSession',
    entityId: session.id,
    metadata: { cajaId, openingCash: data.openingCash, openingElectronic: data.openingElectronic },
  });

  return session;
}

// Cierra una caja: calcula el corte (efectivo/electrónico) sumando ventas y
// restando compras del turno, y registra las diferencias declaradas.
export async function closeCaja(
  sessionId: string,
  storeId: string,
  userId: string,
  role: string,
  data: CloseCajaInput
) {
  const session = await prisma.cajaSession.findFirst({
    where: { id: sessionId, storeId },
    include: { caja: true },
  });
  if (!session) throw ApiError.notFound('Sesión de caja no encontrada', 'CAJA_SESSION_NOT_FOUND');
  if (session.status === 'CLOSED') {
    throw ApiError.badRequest('La caja ya está cerrada', 'CAJA_YA_CERRADA');
  }
  if (role === Role.VENDEDOR && session.userId !== userId) {
    throw ApiError.forbidden(
      'Solo el operador que abrió la caja puede cerrarla',
      'CAJA_NOT_OPERATOR'
    );
  }

  const saleGroups = await prisma.sale.groupBy({
    by: ['paymentMethod'],
    where: { cajaSessionId: session.id, storeId, status: 'COMPLETED' },
    _sum: { total: true },
  });
  const purchaseGroups = await prisma.supplierTransaction.groupBy({
    by: ['paymentMethod'],
    where: { cajaSessionId: session.id, storeId, status: 'COMPLETED' },
    _sum: { total: true },
  });

  let salesCash = new Prisma.Decimal(0);
  let salesElectronic = new Prisma.Decimal(0);
  for (const g of saleGroups) {
    const total = g._sum.total ?? new Prisma.Decimal(0);
    if (isElectronic(g.paymentMethod as PaymentMethod)) salesElectronic = salesElectronic.plus(total);
    else salesCash = salesCash.plus(total);
  }

  let purchasesCash = new Prisma.Decimal(0);
  let purchasesElectronic = new Prisma.Decimal(0);
  for (const g of purchaseGroups) {
    const total = g._sum.total ?? new Prisma.Decimal(0);
    if (isElectronic(g.paymentMethod as PaymentMethod)) purchasesElectronic = purchasesElectronic.plus(total);
    else purchasesCash = purchasesCash.plus(total);
  }

  const openingCash = new Prisma.Decimal(session.openingCash);
  const openingElectronic = new Prisma.Decimal(session.openingElectronic);

  const expectedCash = openingCash.plus(salesCash).minus(purchasesCash);
  const expectedElectronic = openingElectronic.plus(salesElectronic).minus(purchasesElectronic);

  const closingCash = new Prisma.Decimal(data.closingCash);
  const closingElectronic = new Prisma.Decimal(data.closingElectronic);

  const diffCash = closingCash.minus(expectedCash);
  const diffElectronic = closingElectronic.minus(expectedElectronic);

  const closed = await prisma.cajaSession.update({
    where: { id: session.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      closedBy: userId,
      closingCash,
      closingElectronic,
      closingNote: data.closingNote ?? null,
      salesCash,
      salesElectronic,
      purchasesCash,
      purchasesElectronic,
      expectedCash,
      expectedElectronic,
      diffCash,
      diffElectronic,
    },
    include: sessionInclude,
  });

  await audit({
    storeId,
    userId,
    action: 'CLOSE_CAJA',
    entity: 'CajaSession',
    entityId: session.id,
    metadata: {
      cajaId: session.cajaId,
      expectedCash: expectedCash.toString(),
      expectedElectronic: expectedElectronic.toString(),
      diffCash: diffCash.toString(),
      diffElectronic: diffElectronic.toString(),
    },
  });

  return closed;
}

// Sesión activa (abierta) para un usuario: la de su caja asignada, o la
// sesión abierta donde es el operador.
export async function getActiveSession(storeId: string, userId: string) {
  const caja = await prisma.caja.findFirst({
    where: { assignedUserId: userId, storeId, isActive: true },
    select: { id: true },
  });
  const where: Prisma.CajaSessionWhereInput = { storeId, status: 'OPEN' };
  if (caja) where.cajaId = caja.id;
  else where.userId = userId;

  return prisma.cajaSession.findFirst({
    where,
    include: {
      caja: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { openedAt: 'desc' },
  });
}

export interface SessionFilters {
  cajaId?: string;
  status?: 'OPEN' | 'CLOSED';
  startDate?: string;
  endDate?: string;
}

export async function listSessions(storeId: string, filters: SessionFilters = {}) {
  const where: Prisma.CajaSessionWhereInput = { storeId };
  if (filters.cajaId) where.cajaId = filters.cajaId;
  if (filters.status) where.status = filters.status;

  if (filters.startDate || filters.endDate) {
    const openedAt: Prisma.DateTimeFilter = {};
    if (filters.startDate) openedAt.gte = colombiaStartOfDay(filters.startDate);
    if (filters.endDate) {
      const end = colombiaStartOfDay(filters.endDate);
      end.setHours(23, 59, 59, 999);
      openedAt.lte = end;
    }
    where.openedAt = openedAt;
  }

  const sessions = await prisma.cajaSession.findMany({
    where,
    include: {
      caja: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { openedAt: 'desc' },
  });
  return sessions;
}

// Reporte de corte de la sesión: ventas/compras del turno y reconciliación de
// inventario (inicial del snapshot de apertura vs final actual).
export async function getSessionReport(sessionId: string, storeId: string) {
  const session = await prisma.cajaSession.findFirst({
    where: { id: sessionId, storeId },
    include: {
      caja: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  });
  if (!session) throw ApiError.notFound('Sesión de caja no encontrada', 'CAJA_SESSION_NOT_FOUND');

  const desde = colombiaStartOfDay(colombiaLocalDateKey(session.openedAt));
  const hasta = session.closedAt ?? new Date();

  const sales = await prisma.sale.findMany({
    where: { cajaSessionId: session.id, storeId },
    select: {
      id: true,
      saleNumber: true,
      total: true,
      paymentMethod: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const purchases = await prisma.supplierTransaction.findMany({
    where: { cajaSessionId: session.id, storeId },
    select: {
      id: true,
      reference: true,
      total: true,
      paymentMethod: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Inventario: inicial (snapshot de apertura o reconstrucción) vs final.
  const inventories = await prisma.inventory.findMany({
    where: { storeId },
    include: { product: { select: { id: true, name: true, unidadVenta: true } } },
  });

  const snapshots = await prisma.inventorySnapshot.findMany({
    where: { storeId, date: desde },
  });
  const snapshotMap = new Map(snapshots.map((s) => [s.productId, s.quantity]));

  const saleItems = await prisma.saleItem.findMany({
    where: { sale: { cajaSessionId: session.id, storeId } },
    select: { productId: true, quantity: true },
  });
  const ventas = new Map<string, Prisma.Decimal>();
  for (const it of saleItems) {
    ventas.set(it.productId, (ventas.get(it.productId) ?? new Prisma.Decimal(0)).plus(it.quantity));
  }

  const movements = await prisma.stockMovement.findMany({
    where: { storeId, status: 'ACTIVE', createdAt: { gte: desde, lte: hasta } },
    select: { productId: true, tipo: true, quantity: true },
  });
  const entradas = new Map<string, Prisma.Decimal>();
  const salidas = new Map<string, Prisma.Decimal>();
  for (const m of movements) {
    const map = m.tipo === 'ENTRADA' ? entradas : salidas;
    map.set(m.productId, (map.get(m.productId) ?? new Prisma.Decimal(0)).plus(m.quantity));
  }

  const inventory = inventories.map((inv) => {
    const venta = ventas.get(inv.productId) ?? new Prisma.Decimal(0);
    const entrada = entradas.get(inv.productId) ?? new Prisma.Decimal(0);
    const salida = salidas.get(inv.productId) ?? new Prisma.Decimal(0);
    const snap = snapshotMap.get(inv.productId);
    const initial =
      snap !== undefined
        ? snap
        : new Prisma.Decimal(inv.quantity).plus(venta).plus(salida).minus(entrada);
    return {
      productId: inv.productId,
      productName: inv.product.name,
      unidadVenta: inv.product.unidadVenta,
      initial: Number(initial),
      ventas: Number(venta),
      entradas: Number(entrada),
      salidas: Number(salida),
      final: Number(inv.quantity),
    };
  });

  return {
    session,
    sales: sales.map((s) => ({ ...s, total: Number(s.total) })),
    purchases: purchases.map((p) => ({ ...p, total: Number(p.total) })),
    inventory,
    inventoryAdjusted: session.inventoryAdjusted ?? false,
  };
}
