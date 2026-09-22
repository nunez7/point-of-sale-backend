import { prisma } from '../config/prisma';
import { Prisma, CotizacionStatus } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import { auditTx } from '../utils/audit';

export interface CreateCotizacionInput {
  items: { productId: string; quantity: number; unitPrice: number }[];
  discount?: number;
  clienteId?: string | null;
  notes?: string | null;
  validUntil?: string | null;
  status?: 'BORRADOR' | 'ENVIADA';
}

export interface UpdateCotizacionInput {
  items?: { productId: string; quantity: number; unitPrice: number }[];
  discount?: number;
  clienteId?: string | null;
  notes?: string | null;
  validUntil?: string | null;
}

type Tx = Prisma.TransactionClient;

function etiquetaUnidad(unidadVenta: string): string {
  switch (unidadVenta) {
    case 'PESO': return 'kg';
    case 'VOLUMEN': return 'L';
    default: return 'u';
  }
}

async function generateCotizacionNumber(tx: Tx, storeId: string, code: string): Promise<string> {
  const store = await tx.store.update({
    where: { id: storeId },
    data: { cotizacionSequence: { increment: 1 } },
  });
  return `${code}-COT-${String(store.cotizacionSequence).padStart(4, '0')}`;
}

// Auto-mark expired cotizaciones before listing/detail.
async function markExpired(storeId?: string): Promise<void> {
  const where: Prisma.CotizacionWhereInput = {
    status: { in: [CotizacionStatus.BORRADOR, CotizacionStatus.ENVIADA] },
    validUntil: { not: null, lt: new Date() },
  };
  if (storeId) where.storeId = storeId;
  await prisma.cotizacion.updateMany({ where, data: { status: CotizacionStatus.VENCIDA } });
}

const includeItems = {
  items: {
    include: { product: { select: { id: true, name: true, presentacion: true } } },
  },
  cliente: { select: { id: true, nombreRazonSocial: true, rfc: true } },
  user: { select: { id: true, name: true } },
  convertedSale: { select: { id: true, saleNumber: true, status: true } },
};

export async function createCotizacion(
  data: CreateCotizacionInput,
  userId: string,
  storeId: string
) {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, code: true } });
  if (!store) throw ApiError.notFound('Tienda no encontrada', 'TIENDA_NOT_FOUND');

  // Validate products exist and belong to store
  const productIds = data.items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, storeId, isActive: true },
    select: { id: true, name: true, unidadVenta: true, sellingPrice: true },
  });
  if (products.length !== productIds.length) {
    throw ApiError.badRequest('Uno o más productos no existen o están inactivos', 'INVALID_PRODUCTS');
  }
  const productMap = new Map(products.map((p) => [p.id, p]));

  const discount = data.discount ?? 0;

  return prisma.$transaction(async (tx) => {
    const cotizacionNumber = await generateCotizacionNumber(tx, storeId, store.code);

    // Build items with snapshot data
    const preparedItems = data.items.map((item) => {
      const product = productMap.get(item.productId)!;
      return {
        productId: item.productId,
        quantity: new Prisma.Decimal(item.quantity),
        unidad: etiquetaUnidad(product.unidadVenta),
        unitPrice: new Prisma.Decimal(item.unitPrice),
      };
    });

    // Calculate totals
    const subtotal = preparedItems.reduce(
      (sum, item) => sum.add(item.unitPrice.mul(item.quantity)),
      new Prisma.Decimal(0)
    );
    const total = subtotal.minus(new Prisma.Decimal(discount));

    const validUntil = data.validUntil ? new Date(data.validUntil) : null;

    const cotizacion = await tx.cotizacion.create({
      data: {
        cotizacionNumber,
        storeId,
        userId,
        clienteId: data.clienteId ?? null,
        subtotal,
        discount: new Prisma.Decimal(discount),
        total,
        status: data.status ?? CotizacionStatus.BORRADOR,
        notes: data.notes ?? null,
        validUntil,
        items: { createMany: { data: preparedItems } },
      },
      include: includeItems,
    });

    await auditTx(tx, {
      storeId,
      userId,
      action: 'CREATE',
      entity: 'COTIZACION',
      entityId: cotizacion.id,
      metadata: { cotizacionNumber, total: Number(total), status: cotizacion.status },
    });

    return cotizacion;
  });
}

export async function listCotizaciones(
  storeId: string,
  filters: {
    status?: string;
    startDate?: string;
    endDate?: string;
    clienteId?: string;
    search?: string;
  }
) {
  await markExpired(storeId);

  const where: Prisma.CotizacionWhereInput = { storeId };

  if (filters.status && filters.status !== 'ALL') {
    where.status = filters.status as CotizacionStatus;
  }
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) where.createdAt.lte = new Date(filters.endDate + 'T23:59:59.999Z');
  }
  if (filters.clienteId) {
    where.clienteId = filters.clienteId;
  }
  if (filters.search) {
    where.OR = [
      { cotizacionNumber: { contains: filters.search, mode: 'insensitive' } },
      { notes: { contains: filters.search, mode: 'insensitive' } },
      { cliente: { nombreRazonSocial: { contains: filters.search, mode: 'insensitive' } } },
    ];
  }

  const cotizaciones = await prisma.cotizacion.findMany({
    where,
    include: includeItems,
    orderBy: { createdAt: 'desc' },
  });

  return cotizaciones;
}

export async function getCotizacion(id: string, storeId: string) {
  await markExpired();

  const cotizacion = await prisma.cotizacion.findFirst({
    where: { id, storeId },
    include: includeItems,
  });
  if (!cotizacion) {
    throw ApiError.notFound('Cotización no encontrada', 'COTIZACION_NOT_FOUND');
  }
  return cotizacion;
}

export async function updateCotizacion(
  id: string,
  data: UpdateCotizacionInput,
  userId: string,
  storeId: string
) {
  const existing = await prisma.cotizacion.findFirst({ where: { id, storeId } });
  if (!existing) {
    throw ApiError.notFound('Cotización no encontrada', 'COTIZACION_NOT_FOUND');
  }
  if (existing.status !== CotizacionStatus.BORRADOR) {
    throw ApiError.badRequest('Solo se pueden editar cotizaciones en borrador', 'NOT_EDITABLE');
  }

  return prisma.$transaction(async (tx) => {
    // If items are being replaced, recalculate totals
    let subtotal = existing.subtotal;
    let total = existing.total;

    if (data.items && data.items.length > 0) {
      const productIds = data.items.map((i) => i.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, storeId, isActive: true },
        select: { id: true, unidadVenta: true },
      });
      if (products.length !== productIds.length) {
        throw ApiError.badRequest('Uno o más productos no existen o están inactivos', 'INVALID_PRODUCTS');
      }
      const productMap = new Map(products.map((p) => [p.id, p]));

      // Delete old items and create new ones
      await tx.cotizacionItem.deleteMany({ where: { cotizacionId: id } });

      const preparedItems = data.items.map((item) => {
        const product = productMap.get(item.productId)!;
        return {
          cotizacionId: id,
          productId: item.productId,
          quantity: new Prisma.Decimal(item.quantity),
          unidad: etiquetaUnidad(product.unidadVenta),
          unitPrice: new Prisma.Decimal(item.unitPrice),
        };
      });

      await tx.cotizacionItem.createMany({ data: preparedItems });

      subtotal = preparedItems.reduce(
        (sum, item) => sum.add(item.unitPrice.mul(item.quantity)),
        new Prisma.Decimal(0)
      );
      const discount = new Prisma.Decimal(data.discount ?? Number(existing.discount));
      total = subtotal.minus(discount);
    }

    const discount = data.discount !== undefined ? new Prisma.Decimal(data.discount) : existing.discount;
    if (data.discount !== undefined) {
      total = subtotal.minus(discount);
    }

    const validUntil = data.validUntil !== undefined
      ? (data.validUntil ? new Date(data.validUntil) : null)
      : existing.validUntil;

    const updated = await tx.cotizacion.update({
      where: { id },
      data: {
        ...(data.clienteId !== undefined && { clienteId: data.clienteId ?? null }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        ...(data.discount !== undefined && { discount }),
        ...(data.items && { subtotal, total }),
        ...(validUntil !== existing.validUntil && { validUntil }),
      },
      include: includeItems,
    });

    await auditTx(tx, {
      storeId,
      userId,
      action: 'UPDATE',
      entity: 'COTIZACION',
      entityId: id,
      metadata: { changes: { discount: data.discount, clienteId: data.clienteId } },
    });

    return updated;
  });
}

export async function updateCotizacionStatus(
  id: string,
  newStatus: CotizacionStatus,
  userId: string,
  storeId: string,
  motivo?: string
) {
  const existing = await prisma.cotizacion.findFirst({ where: { id, storeId } });
  if (!existing) {
    throw ApiError.notFound('Cotización no encontrada', 'COTIZACION_NOT_FOUND');
  }

  // Validate transitions
  const allowed: Record<string, CotizacionStatus[]> = {
    BORRADOR: [CotizacionStatus.ENVIADA, CotizacionStatus.CANCELADA],
    ENVIADA: [CotizacionStatus.ACEPTADA, CotizacionStatus.CANCELADA],
    ACEPTADA: [],
    CANCELADA: [],
    VENCIDA: [],
  };
  if (!allowed[existing.status]?.includes(newStatus)) {
    throw ApiError.badRequest(
      `No se puede cambiar de ${existing.status} a ${newStatus}`,
      'INVALID_STATUS_TRANSITION'
    );
  }

  const updateData: Prisma.CotizacionUpdateInput = { status: newStatus };

  if (newStatus === CotizacionStatus.ENVIADA) {
    updateData.sentAt = new Date();
  } else if (newStatus === CotizacionStatus.ACEPTADA) {
    updateData.acceptedAt = new Date();
  } else if (newStatus === CotizacionStatus.CANCELADA) {
    updateData.canceledAt = new Date();
    updateData.canceledBy = userId;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.cotizacion.update({
      where: { id },
      data: updateData,
      include: includeItems,
    });

    await auditTx(tx, {
      storeId,
      userId,
      action: 'STATUS_CHANGE',
      entity: 'COTIZACION',
      entityId: id,
      metadata: { from: existing.status, to: newStatus, motivo: motivo ?? null },
    });

    return result;
  });

  return updated;
}

export async function convertToSale(id: string, userId: string, storeId: string) {
  const existing = await prisma.cotizacion.findFirst({
    where: { id, storeId },
    include: { items: true },
  });
  if (!existing) {
    throw ApiError.notFound('Cotización no encontrada', 'COTIZACION_NOT_FOUND');
  }
  if (existing.status !== CotizacionStatus.ACEPTADA) {
    throw ApiError.badRequest('Solo se pueden convertir cotizaciones aceptadas', 'NOT_CONVERTIBLE');
  }

  // Create a PENDING sale from the cotizacion
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, code: true } });
  if (!store) throw ApiError.notFound('Tienda no encontrada', 'TIENDA_NOT_FOUND');

  return prisma.$transaction(async (tx) => {
    // Generate sale number
    const saleStore = await tx.store.update({
      where: { id: storeId },
      data: { saleSequence: { increment: 1 } },
    });
    const saleNumber = `${store.code}-${String(saleStore.saleSequence).padStart(4, '0')}`;

    // Get product data for cost/profit calculations
    const productIds = existing.items.map((i) => i.productId);
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, costPrice: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Build sale items with cost/profit
    const saleItems = existing.items.map((item) => {
      const product = productMap.get(item.productId);
      const costPrice = product?.costPrice ?? new Prisma.Decimal(0);
      const profit = item.unitPrice.sub(costPrice).mul(item.quantity);
      return {
        productId: item.productId,
        quantity: item.quantity,
        unidad: item.unidad,
        unitPrice: item.unitPrice,
        costPrice,
        profit,
      };
    });

    const subtotal = saleItems.reduce(
      (sum, item) => sum.add(item.unitPrice.mul(item.quantity)),
      new Prisma.Decimal(0)
    );
    const profit = saleItems.reduce((sum, item) => sum.add(item.profit), new Prisma.Decimal(0));
    const total = subtotal.minus(existing.discount);
    const profitMargin = total.greaterThan(0)
      ? profit.div(total).mul(new Prisma.Decimal(100))
      : new Prisma.Decimal(0);

    const sale = await tx.sale.create({
      data: {
        saleNumber,
        storeId,
        userId,
        clienteId: existing.clienteId,
        subtotal,
        discount: existing.discount,
        total,
        profit,
        profitMargin,
        paymentMethod: 'PENDING' as never, // Will be set on confirmation
        status: 'PENDING',
        notes: existing.notes ? `[Cotización ${existing.cotizacionNumber}] ${existing.notes}` : `[Cotización ${existing.cotizacionNumber}]`,
        items: { createMany: { data: saleItems } },
      },
      select: { id: true, saleNumber: true, status: true },
    });

    // Link cotizacion to sale
    await tx.cotizacion.update({
      where: { id },
      data: { convertedSaleId: sale.id },
    });

    await auditTx(tx, {
      storeId,
      userId,
      action: 'CONVERT',
      entity: 'COTIZACION',
      entityId: id,
      metadata: { saleId: sale.id, saleNumber: sale.saleNumber },
    });

    return sale;
  });
}

export async function deleteCotizacion(id: string, userId: string, storeId: string) {
  const existing = await prisma.cotizacion.findFirst({ where: { id, storeId } });
  if (!existing) {
    throw ApiError.notFound('Cotización no encontrada', 'COTIZACION_NOT_FOUND');
  }
  if (existing.status !== CotizacionStatus.BORRADOR) {
    throw ApiError.badRequest('Solo se pueden eliminar cotizaciones en borrador', 'NOT_DELETABLE');
  }

  await prisma.$transaction(async (tx) => {
    await tx.cotizacionItem.deleteMany({ where: { cotizacionId: id } });
    await tx.cotizacion.delete({ where: { id } });

    await auditTx(tx, {
      storeId,
      userId,
      action: 'DELETE',
      entity: 'COTIZACION',
      entityId: id,
      metadata: { cotizacionNumber: existing.cotizacionNumber },
    });
  });
}
