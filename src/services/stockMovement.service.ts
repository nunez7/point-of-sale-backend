import { prisma } from '../config/prisma';
import { MovementTipo, Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { parseLocalDate } from '../utils/dates';

export interface CreateMovementInput {
  storeId: string;
  userId: string;
  productId: string;
  reasonId: string;
  quantity: Prisma.Decimal | number;
  comment?: string | null;
}

function startOfDay(dateStr?: string): Date {
  const base = dateStr ? parseLocalDate(dateStr) : new Date();
  base.setHours(0, 0, 0, 0);
  return base;
}

function endOfDay(dateStr?: string): Date {
  const base = dateStr ? parseLocalDate(dateStr) : new Date();
  base.setHours(23, 59, 59, 999);
  return base;
}

// Aplica el delta de stock al inventario de forma atómica y devuelve
// el saldo antes/después. Lanza INSUFFICIENT_STOCK si una SALIDA deja negativo.
async function applyInventoryDelta(
  tx: Prisma.TransactionClient,
  storeId: string,
  productId: string,
  tipo: MovementTipo,
  quantity: Prisma.Decimal
): Promise<{ before: Prisma.Decimal; after: Prisma.Decimal }> {
  const existing = await tx.inventory.findUnique({
    where: { storeId_productId: { storeId, productId } },
  });
  const before = existing ? existing.quantity : new Prisma.Decimal(0);

  if (tipo === MovementTipo.SALIDA) {
    if (before.lessThan(quantity)) {
      throw ApiError.badRequest(
        'Stock insuficiente para aplicar la salida de inventario',
        'INSUFFICIENT_STOCK'
      );
    }
    const updated = await tx.inventory.update({
      where: { storeId_productId: { storeId, productId } },
      data: { quantity: { decrement: quantity } },
    });
    return { before, after: updated.quantity };
  }

  // ENTRADA
  if (existing) {
    const updated = await tx.inventory.update({
      where: { storeId_productId: { storeId, productId } },
      data: { quantity: { increment: quantity } },
    });
    return { before, after: updated.quantity };
  }
  const created = await tx.inventory.create({
    data: { storeId, productId, quantity },
  });
  return { before: new Prisma.Decimal(0), after: created.quantity };
}

interface StockMovementRecord {
  id: string;
  storeId: string;
  productId: string;
  product?: { name: string; unidadVenta: string } | null;
  userId: string;
  user?: { id: string; name: string } | null;
  reasonId: string;
  reason?: { id: string; name: string; tipo: MovementTipo } | null;
  tipo: MovementTipo;
  quantity: Prisma.Decimal;
  balanceBefore: Prisma.Decimal;
  balanceAfter: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  comment: string | null;
  status: string;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  cancellationComment: string | null;
  createdAt: Date;
}

function serializeMovement(m: StockMovementRecord) {
  return {
    id: m.id,
    storeId: m.storeId,
    productId: m.productId,
    productName: m.product?.name ?? null,
    unidadVenta: m.product?.unidadVenta ?? null,
    userId: m.userId,
    userName: m.user?.name ?? null,
    reasonId: m.reasonId,
    reasonName: m.reason?.name ?? null,
    reasonTipo: m.reason?.tipo ?? m.tipo,
    tipo: m.tipo,
    quantity: Number(m.quantity),
    balanceBefore: Number(m.balanceBefore),
    balanceAfter: Number(m.balanceAfter),
    unitCost: Number(m.unitCost),
    comment: m.comment,
    status: m.status,
    cancelledAt: m.cancelledAt?.toISOString() ?? null,
    cancelledBy: m.cancelledBy ?? null,
    cancellationReason: m.cancellationReason ?? null,
    cancellationComment: m.cancellationComment ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function createMovement(input: CreateMovementInput) {
  const quantity = new Prisma.Decimal(input.quantity);

  return prisma.$transaction(async (tx) => {
    const reason = await tx.movementReason.findFirst({
      where: { id: input.reasonId, storeId: input.storeId, isActive: true },
    });
    if (!reason) {
      throw ApiError.badRequest(
        'Motivo de movimiento no válido o inactivo',
        'REASON_NOT_FOUND'
      );
    }

    const product = await tx.product.findFirst({
      where: { id: input.productId, storeId: input.storeId },
      select: { id: true, name: true, unidadVenta: true, costPrice: true },
    });
    if (!product) {
      throw ApiError.notFound('Producto no encontrado', 'PRODUCT_NOT_FOUND');
    }

    const { before, after } = await applyInventoryDelta(
      tx,
      input.storeId,
      input.productId,
      reason.tipo,
      quantity
    );

    const movement = await tx.stockMovement.create({
      data: {
        storeId: input.storeId,
        productId: input.productId,
        userId: input.userId,
        reasonId: input.reasonId,
        tipo: reason.tipo,
        quantity,
        balanceBefore: before,
        balanceAfter: after,
        unitCost: product.costPrice,
        comment: input.comment ?? null,
        status: 'ACTIVE',
      },
      include: {
        product: { select: { name: true, unidadVenta: true } },
        reason: { select: { id: true, name: true, tipo: true } },
        user: { select: { id: true, name: true } },
      },
    });

    await tx.auditLog.create({
      data: {
        storeId: input.storeId,
        userId: input.userId,
        action: 'STOCK_MOVEMENT',
        entity: 'StockMovement',
        entityId: movement.id,
        metadata: {
          tipo: reason.tipo,
          productId: input.productId,
          quantity: Number(quantity),
          reason: reason.name,
          comment: input.comment ?? null,
        },
      },
    });

    return serializeMovement(movement);
  });
}

export interface MovementFilters {
  startDate?: string;
  endDate?: string;
  productId?: string;
  tipo?: MovementTipo;
  reasonId?: string;
  status?: 'ACTIVE' | 'CANCELLED';
}

export async function listMovements(storeId: string, filters: MovementFilters = {}) {
  const where: Prisma.StockMovementWhereInput = { storeId };

  if (filters.productId) where.productId = filters.productId;
  if (filters.tipo) where.tipo = filters.tipo;
  if (filters.reasonId) where.reasonId = filters.reasonId;
  if (filters.status) where.status = filters.status;

  if (filters.startDate || filters.endDate) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.startDate) {
      createdAt.gte = startOfDay(filters.startDate);
    }
    if (filters.endDate) {
      createdAt.lte = endOfDay(filters.endDate);
    }
    where.createdAt = createdAt;
  }

  const movements = await prisma.stockMovement.findMany({
    where,
    include: {
      product: { select: { name: true, unidadVenta: true } },
      reason: { select: { id: true, name: true, tipo: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return movements.map(serializeMovement);
}

export async function cancelMovement(
  movementId: string,
  storeId: string,
  userId: string,
  cancellationReason: string,
  cancellationComment?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const movement = await tx.stockMovement.findFirst({
      where: { id: movementId, storeId, status: 'ACTIVE' },
    });
    if (!movement) {
      throw ApiError.notFound(
        'Movimiento no encontrado o ya cancelado',
        'MOVEMENT_NOT_FOUND'
      );
    }

    // Movimiento inverso para revertir el efecto en el inventario.
    const inverseTipo =
      movement.tipo === MovementTipo.SALIDA
        ? MovementTipo.ENTRADA
        : MovementTipo.SALIDA;

    const { before, after } = await applyInventoryDelta(
      tx,
      storeId,
      movement.productId,
      inverseTipo,
      movement.quantity
    );

    const inverse = await tx.stockMovement.create({
      data: {
        storeId,
        productId: movement.productId,
        userId,
        reasonId: movement.reasonId,
        tipo: inverseTipo,
        quantity: movement.quantity,
        balanceBefore: before,
        balanceAfter: after,
        unitCost: movement.unitCost,
        comment: `Anulación de movimiento ${movement.id}`,
        status: 'ACTIVE',
      },
      include: {
        product: { select: { name: true, unidadVenta: true } },
        reason: { select: { id: true, name: true, tipo: true } },
        user: { select: { id: true, name: true } },
      },
    });

    await tx.stockMovement.update({
      where: { id: movement.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancellationReason: cancellationReason ?? null,
        cancellationComment: cancellationComment ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'CANCEL_STOCK_MOVEMENT',
        entity: 'StockMovement',
        entityId: movement.id,
        metadata: {
          cancelledMovementId: movement.id,
          inverseMovementId: inverse.id,
          reason: cancellationReason,
          comment: cancellationComment ?? null,
        },
      },
    });

    return serializeMovement(inverse);
  });
}

// Captura el stock actual de todos los productos como apertura del día.
export async function registerOpening(storeId: string, date?: string) {
  const day = startOfDay(date);
  const inventories = await prisma.inventory.findMany({
    where: { storeId },
    select: { productId: true, quantity: true },
  });

  await prisma.$transaction(async (tx) => {
    for (const inv of inventories) {
      await tx.inventorySnapshot.upsert({
        where: {
          storeId_productId_date: { storeId, productId: inv.productId, date: day },
        },
        create: { storeId, productId: inv.productId, date: day, quantity: inv.quantity },
        update: { quantity: inv.quantity },
      });
    }
  });

  return { date: day.toISOString().slice(0, 10), count: inventories.length };
}

export async function hasOpening(storeId: string, date?: string) {
  const day = startOfDay(date);
  const count = await prisma.inventorySnapshot.count({ where: { storeId, date: day } });
  return { date: day.toISOString().slice(0, 10), hasOpening: count > 0 };
}

// Reporte de inventario del día: inicial (snapshot o reconstrucción),
// final, ventas/compras/movimientos y pérdida (salidas) valorizada a costo.
export async function getInventoryReport(storeId: string, date?: string) {
  const desde = startOfDay(date);
  const hasta = endOfDay(date);

  const inventories = await prisma.inventory.findMany({
    where: { storeId },
    include: {
      product: {
        select: { id: true, name: true, unidadVenta: true, costPrice: true },
      },
    },
  });

  const snapshots = await prisma.inventorySnapshot.findMany({
    where: { storeId, date: desde },
  });
  const snapshotMap = new Map(snapshots.map((s) => [s.productId, s.quantity]));

  const sales = await prisma.sale.findMany({
    where: { storeId, status: 'COMPLETED', createdAt: { gte: desde, lte: hasta } },
    include: { items: true },
  });
  const purchases = await prisma.supplierTransaction.findMany({
    where: { storeId, status: 'COMPLETED', createdAt: { gte: desde, lte: hasta } },
    include: { items: true },
  });
  const movements = await prisma.stockMovement.findMany({
    where: { storeId, status: 'ACTIVE', createdAt: { gte: desde, lte: hasta } },
    include: {
      reason: { select: { id: true, name: true, tipo: true } },
      product: {
        select: { id: true, name: true, unidadVenta: true, costPrice: true },
      },
    },
  });

  const ventas = new Map<string, Prisma.Decimal>();
  for (const s of sales)
    for (const it of s.items)
      ventas.set(it.productId, (ventas.get(it.productId) ?? new Prisma.Decimal(0)).plus(it.quantity));

  const compras = new Map<string, Prisma.Decimal>();
  for (const p of purchases)
    for (const it of p.items)
      compras.set(it.productId, (compras.get(it.productId) ?? new Prisma.Decimal(0)).plus(it.quantity));

  const entradas = new Map<string, Prisma.Decimal>();
  const salidas = new Map<string, Prisma.Decimal>();
  for (const m of movements) {
    const map = m.tipo === MovementTipo.ENTRADA ? entradas : salidas;
    map.set(m.productId, (map.get(m.productId) ?? new Prisma.Decimal(0)).plus(m.quantity));
  }

  const lossByReason = new Map<
    string,
    { reason: string; quantity: Prisma.Decimal; value: Prisma.Decimal }
  >();
  let totalLossQty = new Prisma.Decimal(0);
  let totalLossValue = new Prisma.Decimal(0);
  for (const m of movements) {
    if (m.tipo !== MovementTipo.SALIDA) continue;
    const cost = new Prisma.Decimal(m.product.costPrice.toString());
    const value = cost.times(m.quantity);
    totalLossQty = totalLossQty.plus(m.quantity);
    totalLossValue = totalLossValue.plus(value);
    const entry =
      lossByReason.get(m.reason.name) ??
      { reason: m.reason.name, quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) };
    entry.quantity = entry.quantity.plus(m.quantity);
    entry.value = entry.value.plus(value);
    lossByReason.set(m.reason.name, entry);
  }

  const byProduct = inventories.map((inv) => {
    const finalQty = inv.quantity;
    const snap = snapshotMap.get(inv.productId);
    const v = ventas.get(inv.productId) ?? new Prisma.Decimal(0);
    const c = compras.get(inv.productId) ?? new Prisma.Decimal(0);
    const e = entradas.get(inv.productId) ?? new Prisma.Decimal(0);
    const s = salidas.get(inv.productId) ?? new Prisma.Decimal(0);

    let initialQty: Prisma.Decimal;
    if (snap !== undefined) {
      initialQty = snap;
    } else {
      initialQty = finalQty.plus(v).plus(s).minus(c).minus(e);
    }

    const cost = new Prisma.Decimal(inv.product.costPrice.toString());
    return {
      productId: inv.productId,
      productName: inv.product.name,
      unidadVenta: inv.product.unidadVenta,
      initial: Number(initialQty),
      final: Number(finalQty),
      ventas: Number(v),
      compras: Number(c),
      entradas: Number(e),
      salidas: Number(s),
      perdida: Number(s),
      perdidaValor: Number(cost.times(s)),
    };
  });

  return {
    storeId,
    date: desde.toISOString().slice(0, 10),
    hasSnapshot: snapshots.length > 0,
    totalLossQuantity: Number(totalLossQty),
    totalLossValue: Number(totalLossValue),
    byProduct,
    lossByReason: Array.from(lossByReason.values()).map((r) => ({
      reason: r.reason,
      quantity: Number(r.quantity),
      value: Number(r.value),
    })),
  };
}
