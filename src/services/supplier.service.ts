import { prisma } from '../config/prisma';
import { Prisma, MovementTipo, PaymentMethod } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import { mexicoStartOfDay, mexicoEndOfDay } from '../utils/dates';
import { SupplierTxItemInput } from '../types';
import { createPurchaseMovementsInTx, createSupplierCancelMovementsInTx } from './stockMovement.service';
import { resolveCajaSession } from './cajaSession.service';

const PURCHASE_REASON_NAME = 'Compra a proveedor';
const DEFAULT_MARGIN_PCT = 16;

export interface CreateSupplierInput {
  name: string;
  rfc?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  storeId: string;
}

export async function listSuppliers(storeId?: string, search?: string) {
  const where: Prisma.SupplierWhereInput = storeId ? { storeId } : {};
  if (search && search.trim()) {
    where.name = { contains: search.trim(), mode: 'insensitive' };
  }
  return prisma.supplier.findMany({
    where,
    orderBy: { name: 'asc' },
  });
}

// Obtiene (o crea, si no existe) el motivo de movimiento "Compra a proveedor"
// dentro de la transacción del llamador.
async function getOrCreatePurchaseReason(
  tx: Prisma.TransactionClient,
  storeId: string
) {
  let reason = await tx.movementReason.findFirst({
    where: { storeId, name: PURCHASE_REASON_NAME, isActive: true },
  });
  if (!reason) {
    reason = await tx.movementReason.create({
      data: { storeId, name: PURCHASE_REASON_NAME, tipo: MovementTipo.ENTRADA, isActive: true },
    });
  }
  return reason;
}

export async function createSupplier(
  data: CreateSupplierInput,
  userId: string
) {
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: {
        name: data.name,
        rfc: data.rfc ?? undefined,
        phone: data.phone ?? undefined,
        email: data.email ?? undefined,
        address: data.address ?? undefined,
        city: data.city ?? undefined,
        state: data.state ?? undefined,
        postalCode: data.postalCode ?? undefined,
        storeId: data.storeId,
      },
    });

    await tx.auditLog.create({
      data: {
        storeId: data.storeId,
        userId,
        action: 'CREATE',
        entity: 'SUPPLIER',
        entityId: supplier.id,
        metadata: { name: supplier.name },
      },
    });

    return supplier;
  });
}

export async function updateSupplier(
  id: string,
  data: Partial<CreateSupplierInput>,
  userId: string
) {
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.rfc !== undefined && { rfc: data.rfc ?? null }),
        ...(data.phone !== undefined && { phone: data.phone ?? null }),
        ...(data.email !== undefined && { email: data.email ?? null }),
        ...(data.address !== undefined && { address: data.address ?? null }),
        ...(data.city !== undefined && { city: data.city ?? null }),
        ...(data.state !== undefined && { state: data.state ?? null }),
        ...(data.postalCode !== undefined && { postalCode: data.postalCode ?? null }),
      },
    });

    await tx.auditLog.create({
      data: {
        storeId: supplier.storeId,
        userId,
        action: 'UPDATE',
        entity: 'SUPPLIER',
        entityId: supplier.id,
        metadata: { changes: data },
      },
    });

    return supplier;
  });
}

export async function getSupplierTransactions(supplierId: string, storeId: string) {
  const transactions = await prisma.supplierTransaction.findMany({
    where: { supplierId, storeId },
    include: {
      items: {
        include: { product: true },
        orderBy: { id: 'asc' },
      },
      user: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Los Decimal de Prisma se serializan como string en JSON; el frontend
  // espera números (p. ej. reduce() para contar artículos).
  return transactions.map((tx) => ({
    ...tx,
    total: Number(tx.total),
    reference: tx.reference,
    items: tx.items.map((it) => ({
      ...it,
      quantity: Number(it.quantity),
      unitCost: Number(it.unitCost),
      marginPct: Number(it.marginPct),
      sellingPrice: it.sellingPrice != null ? Number(it.sellingPrice) : null,
    })),
  }));
}

// Detalle completo de una compra (para la "Nota de compra" imprimible).
// Acepta un cliente de transacción opcional para poder invocarse dentro de
// una transacción interactiva y ver los cambios aún no confirmados.
export async function getSupplierTransactionById(
  id: string,
  storeId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const tx = await client.supplierTransaction.findFirst({
    where: { id, storeId },
    include: {
      items: {
        include: { product: { select: { id: true, name: true, sku: true, unidadVenta: true } } },
        orderBy: { id: 'asc' },
      },
      user: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true, phone: true, email: true, address: true } },
      store: { select: { id: true, name: true, code: true, address: true } },
    },
  });
  if (!tx) {
    throw ApiError.notFound('Compra a proveedor no encontrada', 'SUPPLIER_TX_NOT_FOUND');
  }

  return {
    ...tx,
    total: Number(tx.total),
    items: tx.items.map((it) => ({
      ...it,
      quantity: Number(it.quantity),
      unitCost: Number(it.unitCost),
      marginPct: Number(it.marginPct),
      sellingPrice: it.sellingPrice != null ? Number(it.sellingPrice) : null,
      subtotal: Number(new Prisma.Decimal(it.unitCost.toString()).mul(it.quantity)),
    })),
  };
}

// Lista de compras de toda la tienda (reporte recuperable).
export async function listStoreTransactions(
  storeId: string,
  filters: { startDate?: string; endDate?: string } = {}
) {
  const where: Prisma.SupplierTransactionWhereInput = { storeId };
  if (filters.startDate || filters.endDate) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.startDate) createdAt.gte = mexicoStartOfDay(filters.startDate);
    if (filters.endDate) createdAt.lte = mexicoEndOfDay(filters.endDate);
    where.createdAt = createdAt;
  }

  const transactions = await prisma.supplierTransaction.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { id: true, name: true, sku: true, unidadVenta: true } } },
        orderBy: { id: 'asc' },
      },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return transactions.map((tx) => ({
    ...tx,
    total: Number(tx.total),
    items: tx.items.map((it) => ({
      ...it,
      quantity: Number(it.quantity),
      unitCost: Number(it.unitCost),
      marginPct: Number(it.marginPct),
      sellingPrice: it.sellingPrice != null ? Number(it.sellingPrice) : null,
      subtotal: Number(new Prisma.Decimal(it.unitCost.toString()).mul(it.quantity)),
    })),
  }));
}

export interface CreateSupplierTxInput {
  supplierId: string;
  storeId: string;
  userId: string;
  items: SupplierTxItemInput[];
  paymentMethod: string;
  // Origen del pago: "CAJA" (descuenta del corte) o "DUENO" (no afecta corte).
  paidFrom?: "CAJA" | "DUENO" | null;
  // Sesión de caja que procesa la compra (solo cuando paidFrom = "CAJA").
  cajaSessionId?: string | null;
}

export async function createSupplierTransaction(input: CreateSupplierTxInput) {
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, storeId: input.storeId },
    });
    if (!supplier) {
      throw ApiError.notFound('Proveedor no encontrado en esta tienda', 'SUPPLIER_NOT_FOUND');
    }

    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store) {
      throw ApiError.notFound('Tienda no encontrada', 'STORE_NOT_FOUND');
    }

    // Si la compra se paga con dinero de caja, debe vincularse a la sesión
    // abierta del usuario (su caja asignada o la que operó). Si se paga con
    // efectivo de dueño, queda registrada sin afectar el corte.
    const paidFrom = input.paidFrom ?? "DUENO";
    if (paidFrom === "CAJA") {
      input.cajaSessionId = await resolveCajaSession(tx, input.storeId, input.userId, input.cajaSessionId);
    }

    let total = new Prisma.Decimal(0);
    const preparedItems: Array<{
      productId: string;
      quantity: number;
      unitCost: Prisma.Decimal;
      marginPct: Prisma.Decimal;
      sellingPrice: Prisma.Decimal;
    }> = [];

    const productIds = input.items.map((i) => i.productId);
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, storeId: input.storeId },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of input.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw ApiError.badRequest('Producto no encontrado en esta tienda', 'PRODUCT_NOT_FOUND');
      }
      if (item.unitCost <= 0 || item.quantity <= 0) {
        throw ApiError.badRequest('Costo unitario y cantidad deben ser positivos', 'INVALID_INPUT');
      }

      const marginPct = new Prisma.Decimal(item.marginPct ?? DEFAULT_MARGIN_PCT);
      // Precio sugerido = costo * (1 + margen/100). Si el usuario lo
      // sobrescribe, prevalece su valor (mayor ganancia).
      const suggested = new Prisma.Decimal(item.unitCost).mul(
        new Prisma.Decimal(1).plus(marginPct.div(100))
      );
      const sellingPrice = item.sellingPrice != null
        ? new Prisma.Decimal(item.sellingPrice)
        : suggested;

      total = total.plus(new Prisma.Decimal(item.unitCost).mul(item.quantity));
      preparedItems.push({
        productId: product.id,
        quantity: item.quantity,
        unitCost: new Prisma.Decimal(item.unitCost),
        marginPct,
        sellingPrice,
      });
    }

    // Folio secuencial de compra (ej. COMPRA-STORE001-0001).
    const sequence = (store.purchaseSequence ?? 0) + 1;
    const reference = `COMPRA-${store.code}-${String(sequence).padStart(4, '0')}`;
    await tx.store.update({
      where: { id: store.id },
      data: { purchaseSequence: sequence },
    });

    const transaction = await tx.supplierTransaction.create({
      data: {
        supplierId: input.supplierId,
        storeId: input.storeId,
        userId: input.userId,
        reference,
        total,
        paymentMethod: input.paymentMethod as PaymentMethod,
        paidFrom,
        ...(input.cajaSessionId ? { cajaSessionId: input.cajaSessionId } : {}),
        items: {
          create: preparedItems.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            unitCost: it.unitCost,
            marginPct: it.marginPct,
            sellingPrice: it.sellingPrice,
          })),
        },
      },
      include: { items: true },
    });

    // Actualiza el costo y el precio de venta sugerido/sobrescrito del producto.
    for (const it of preparedItems) {
      await tx.product.update({
        where: { id: it.productId },
        data: { costPrice: it.unitCost, sellingPrice: it.sellingPrice },
      });
    }

    // Registra el movimiento de entrada en StockMovement (tipo "Compra a proveedor").
    const reason = await getOrCreatePurchaseReason(tx, input.storeId);
    await createPurchaseMovementsInTx(tx, {
      storeId: input.storeId,
      userId: input.userId,
      reasonId: reason.id,
      referenceId: transaction.id,
      items: preparedItems.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
        unitCost: it.unitCost,
      })),
    });

    await tx.auditLog.create({
      data: {
        storeId: input.storeId,
        userId: input.userId,
        action: 'SUPPLIER_TRANSACTION',
        entity: 'SUPPLIER_TRANSACTION',
        entityId: transaction.id,
        metadata: {
          supplierId: input.supplierId,
          reference,
          total: total.toString(),
          items: input.items.length,
          paymentMethod: input.paymentMethod,
        },
      },
    });

    const full = await getSupplierTransactionById(transaction.id, input.storeId, tx);
    return full;
  });
}

export async function cancelSupplierTransaction(
  id: string,
  storeId: string,
  userId: string,
  cancellationReasonId?: string,
  comment?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const txRecord = await tx.supplierTransaction.findFirst({
      where: { id, storeId, status: 'COMPLETED' },
      include: { items: true },
    });
    if (!txRecord) {
      throw ApiError.notFound(
        'Compra a proveedor no encontrada o ya cancelada',
        'SUPPLIER_TX_NOT_FOUND'
      );
    }

    // Movimiento inverso (SALIDA) por cada ítem para mantener el inventario
    // y el reporte coherentes y 100% trazables.
    await createSupplierCancelMovementsInTx(tx, {
      storeId,
      userId,
      referenceId: id,
      items: txRecord.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitCost: item.unitCost,
      })),
    });

    const canceled = await tx.supplierTransaction.update({
      where: { id },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
        canceledBy: userId,
        ...(cancellationReasonId && { cancellationReasonId }),
        ...(comment !== undefined && { cancellationComment: comment }),
      },
    });

    if (cancellationReasonId) {
      await tx.cancellation.create({
        data: {
          storeId,
          userId,
          entityType: 'SUPPLIER_TRANSACTION',
          entityId: id,
          entityNumber: txRecord.reference,
          total: txRecord.total,
          type: 'FULL',
          cancellationReasonId,
          comment: comment ?? null,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'CANCEL_SUPPLIER_TX',
        entity: 'SUPPLIER_TRANSACTION',
        entityId: id,
        metadata: {
          reference: txRecord.reference,
          total: txRecord.total.toString(),
          ...(cancellationReasonId && { cancellationReasonId }),
          ...(comment && { comment }),
        },
      },
    });

    return canceled;
  });
}
