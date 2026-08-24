import { prisma } from '../config/prisma';
import { Prisma, PaymentMethod } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { SaleItemInput } from '../types';
import { parseLocalDate } from '../utils/dates';

export interface CreateSaleInput {
  storeId: string;
  userId: string;
  items: SaleItemInput[];
  paymentMethod: string;
  discount: number;
}

export interface SaleResult {
  id: string;
  saleNumber: string;
  total: number;
  profit: number;
  profitMargin: number;
}

type Tx = Prisma.TransactionClient;

// Etiqueta corta para el snapshot de la línea de venta ("u", "kg", "L").
function etiquetaUnidad(unidadVenta: string): string {
  switch (unidadVenta) {
    case 'PESO':
      return 'kg';
    case 'VOLUMEN':
      return 'L';
    default:
      return 'u';
  }
}

async function generateSaleNumber(tx: Tx, storeId: string, code: string): Promise<string> {
  const store = await tx.store.update({
    where: { id: storeId },
    data: { saleSequence: { increment: 1 } },
  });
  return `${code}-${String(store.saleSequence).padStart(4, '0')}`;
}

export async function createSale(input: CreateSaleInput): Promise<SaleResult> {
  return prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store) throw ApiError.notFound('Tienda no encontrada', 'STORE_NOT_FOUND');

    if (input.discount < 0 || input.discount > 100) {
      throw ApiError.badRequest('El descuento debe estar entre 0 y 100%', 'INVALID_DISCOUNT');
    }

    // Validate stock and load product cost + price for all items
    let subtotal = new Prisma.Decimal(0);
    const preparedItems: Array<{
      productId: string;
      quantity: number;
      unidad: string;
      unitPrice: number;
      costPrice: Prisma.Decimal;
      unitProfit: Prisma.Decimal;
    }> = [];

    const productIds = input.items.map((i) => i.productId);

    const products = await tx.product.findMany({
      where: { id: { in: productIds }, storeId: input.storeId, isActive: true },
    });
    if (products.length !== productIds.length) {
      throw ApiError.badRequest('Uno o más productos no existen en esta tienda', 'PRODUCT_NOT_FOUND');
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of input.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw ApiError.badRequest('Producto no encontrado', 'PRODUCT_NOT_FOUND');
      }

      // Los productos por unidad solo admiten cantidades enteras; el granel
      // (peso/volumen) admite hasta 3 decimales (gramos/ml).
      if (
        product.unidadVenta === 'UNIDAD' &&
        !Number.isInteger(item.quantity)
      ) {
        throw ApiError.badRequest(
          `"${product.name}" se vende por unidad: la cantidad debe ser un número entero`,
          'INVALID_QUANTITY'
        );
      }

      const inventory = await tx.inventory.findUnique({
        where: { storeId_productId: { storeId: input.storeId, productId: product.id } },
      });

      const stock = inventory?.quantity ?? new Prisma.Decimal(0);
      if (new Prisma.Decimal(stock).lessThan(item.quantity)) {
        throw ApiError.badRequest(
          `Stock insuficiente para "${product.name}" (disponible: ${Number(stock)})`,
          'INSUFFICIENT_STOCK'
        );
      }

      if (item.unitPrice <= 0) {
        throw ApiError.badRequest('El precio unitario debe ser positivo', 'INVALID_PRICE');
      }

      const costPrice = product.costPrice;
      const unitProfit = new Prisma.Decimal(item.unitPrice).minus(costPrice);

      subtotal = subtotal.plus(new Prisma.Decimal(item.unitPrice).mul(item.quantity));
      preparedItems.push({
        productId: product.id,
        quantity: item.quantity,
        unidad: etiquetaUnidad(product.unidadVenta),
        unitPrice: item.unitPrice,
        costPrice,
        unitProfit,
      });
    }

    const discountDecimal = new Prisma.Decimal(input.discount).div(100);
    const discountAmount = subtotal.mul(discountDecimal);
    const total = subtotal.minus(discountAmount);

    let totalProfit = new Prisma.Decimal(0);
    for (const it of preparedItems) {
      // discount prorated across items for accurate profit
      const itemSubtotal = new Prisma.Decimal(it.unitPrice).mul(it.quantity);
      const itemDiscount = itemSubtotal.mul(discountDecimal);
      const itemNet = itemSubtotal.minus(itemDiscount);
      const itemProfit = itemNet.minus(it.costPrice.mul(it.quantity));
      totalProfit = totalProfit.plus(itemProfit);
    }

    const saleNumber = await generateSaleNumber(tx, input.storeId, store.code);

    const sale = await tx.sale.create({
      data: {
        saleNumber,
        storeId: input.storeId,
        userId: input.userId,
        subtotal,
        discount: discountAmount,
        total,
        profit: totalProfit,
        profitMargin: total.gt(0) ? totalProfit.div(total).mul(100) : new Prisma.Decimal(0),
        paymentMethod: input.paymentMethod as PaymentMethod,
        items: {
          create: preparedItems.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            unidad: it.unidad,
            unitPrice: it.unitPrice,
            costPrice: it.costPrice,
            profit: new Prisma.Decimal(it.unitPrice)
              .minus(it.costPrice)
              .mul(it.quantity),
          })),
        },
      },
      include: { items: true },
    });

    // Deduct inventory atomically
    for (const it of preparedItems) {
      const updated = await tx.inventory.updateMany({
        where: {
          storeId: input.storeId,
          productId: it.productId,
          quantity: { gte: it.quantity },
        },
        data: { quantity: { decrement: it.quantity } },
      });
      if (updated.count === 0) {
        throw ApiError.badRequest('Stock insuficiente al deducir inventario', 'INSUFFICIENT_STOCK');
      }
    }

    // Audit log
    await tx.auditLog.create({
      data: {
        storeId: input.storeId,
        userId: input.userId,
        action: 'SALE',
        entity: 'SALE',
        entityId: sale.id,
        metadata: {
          saleNumber,
          total: total.toString(),
          items: input.items.length,
          paymentMethod: input.paymentMethod,
        },
      },
    });

    return {
      id: sale.id,
      saleNumber: sale.saleNumber,
      total: Number(total),
      profit: Number(totalProfit),
      profitMargin: Number(sale.profitMargin),
    };
  });
}

// Los Decimal de Prisma se serializan como string en JSON; el frontend espera
// números (p. ej. profitMargin.toFixed()). Convertimos al borde del servicio
// preservando las relaciones incluidas (items, product, user).
function serializeSale<
  T extends {
    total: Prisma.Decimal | number;
    subtotal: Prisma.Decimal | number;
    discount: Prisma.Decimal | number;
    profit: Prisma.Decimal | number;
    profitMargin: Prisma.Decimal | number;
    status: string;
    items: Array<{
      quantity: Prisma.Decimal | number;
      unitPrice: Prisma.Decimal | number;
      costPrice: Prisma.Decimal | number;
      profit: Prisma.Decimal | number;
    }>;
  },
>(sale: T) {
  return {
    ...sale,
    total: Number(sale.total),
    subtotal: Number(sale.subtotal),
    discount: Number(sale.discount),
    profit: Number(sale.profit),
    profitMargin: Number(sale.profitMargin),
    status: sale.status,
    items: sale.items.map((it) => ({
      ...it,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      costPrice: Number(it.costPrice),
      profit: Number(it.profit),
    })),
  };
}

export async function listSales(filters: {
  storeId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const where: Record<string, unknown> = { status: 'COMPLETED' };

  if (filters.storeId) where.storeId = filters.storeId;

  if (filters.startDate || filters.endDate) {
    const createdAt: Record<string, Date> = {};
    if (filters.startDate) {
      const d = parseLocalDate(filters.startDate);
      d.setHours(0, 0, 0, 0);
      createdAt.gte = d;
    }
    if (filters.endDate) {
      const d = parseLocalDate(filters.endDate);
      d.setHours(23, 59, 59, 999);
      createdAt.lte = d;
    }
    if (Object.keys(createdAt).length) where.createdAt = createdAt;
  }

  const sales = await prisma.sale.findMany({
    where,
    include: {
      items: { include: { product: true } },
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return sales.map(serializeSale);
}

export async function getSale(id: string, storeId: string) {
  const sale = await prisma.sale.findFirst({
    where: { id, storeId },
    include: {
      items: { include: { product: { include: { category: true } } } },
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return sale ? serializeSale(sale) : null;
}

export async function getSaleBySaleNumber(storeId: string, saleNumber: string) {
  const sale = await prisma.sale.findFirst({
    where: { saleNumber, storeId, status: 'COMPLETED' },
    include: { items: { include: { product: { include: { category: true } } } } },
  });

  return sale ? serializeSale(sale) : null;
}

export async function cancelSale(
  id: string,
  storeId: string,
  userId: string,
  cancellationReasonId?: string,
  comment?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id, storeId, status: 'COMPLETED' },
      include: { items: true, factura: { select: { id: true, status: true } } },
    });

    if (!sale) {
      throw ApiError.notFound('Venta no encontrada o ya cancelada', 'SALE_NOT_FOUND');
    }

    // No se puede cancelar una venta con factura emitida; primero la factura.
    if (sale.factura && sale.factura.status !== 'CANCELED') {
      throw ApiError.badRequest(
        'No se puede cancelar la venta: tiene una factura emitida. Cancele primero la factura.',
        'SALE_HAS_ACTIVE_INVOICE'
      );
    }

    // Restore inventory atomically
    for (const item of sale.items) {
      await tx.inventory.upsert({
        where: { storeId_productId: { storeId, productId: item.productId } },
        create: {
          storeId,
          productId: item.productId,
          quantity: item.quantity,
        },
        update: { quantity: { increment: item.quantity } },
      });
    }

    const canceled = await tx.sale.update({
      where: { id },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
        canceledBy: userId,
        ...(cancellationReasonId && { cancellationReasonId }),
        ...(comment !== undefined && { cancellationComment: comment }),
      },
    });

    // Create Cancellation record if reason provided
    if (cancellationReasonId) {
      await tx.cancellation.create({
        data: {
          storeId,
          userId,
          entityType: 'SALE',
          entityId: id,
          entityNumber: sale.saleNumber,
          total: sale.total,
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
        action: 'CANCEL_SALE',
        entity: 'SALE',
        entityId: id,
        metadata: {
          saleNumber: sale.saleNumber,
          ...(cancellationReasonId && { cancellationReasonId }),
          ...(comment && { comment }),
        },
      },
    });

    return canceled;
  });
}