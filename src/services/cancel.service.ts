import { prisma } from '../config/prisma';
import { CancellationReason, Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { parseLocalDate } from '../utils/dates';

const MAX_CANCELLATION_HOURS = 24;

interface EntityItem {
  productName: string;
  quantity: number;
  unitPrice?: number;
  unitCost?: number;
  subtotal: number;
}

export interface EntityInfo {
  entityType: string;
  entityId: string;
  entityNumber: string;
  createdAt: Date;
  status: string;
  total: number;
  items: EntityItem[];
  itemCount: number;
  paymentMethod: string;
  // Sale-specific
  saleNumber?: string;
  userId?: string;
  userName?: string;
  // Supplier-specific
  supplierId?: string;
  supplierName?: string;
}

function serializeEntity(entity: EntityInfo) {
  return {
    ...entity,
    createdAt: entity.createdAt.toISOString(),
    total: Number(entity.total),
    items: entity.items.map((it) => ({
      ...it,
      unitPrice: it.unitPrice != null ? Number(it.unitPrice) : undefined,
      unitCost: it.unitCost != null ? Number(it.unitCost) : undefined,
      subtotal: Number(it.subtotal),
    })),
  };
}

export async function lookupEntity(
  entityType: string,
  entityCode: string,
  storeId: string
) {
  const code = entityCode.trim().toUpperCase();

  switch (entityType) {
    case 'SALE': {
      const sale = await prisma.sale.findFirst({
        where: { saleNumber: code, storeId },
        include: {
          items: {
            include: { product: { select: { name: true } } },
          },
          user: { select: { id: true, name: true } },
        },
      });
      if (!sale) {
        throw ApiError.notFound(
          `No se encontró una venta con el número ${code}`,
          'SALE_NOT_FOUND'
        );
      }
      return serializeEntity({
        entityType: 'SALE',
        entityId: sale.id,
        entityNumber: sale.saleNumber,
        createdAt: sale.createdAt,
        status: sale.status,
        total: Number(sale.total),
        saleNumber: sale.saleNumber,
        paymentMethod: sale.paymentMethod,
        userId: sale.userId,
        userName: sale.user.name,
        itemCount: sale.items.length,
        items: sale.items.map((it) => ({
          productName: it.product.name,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          subtotal: Number(it.unitPrice) * Number(it.quantity),
        })),
      });
    }
    case 'FACTURA': {
      const factura = await prisma.factura.findFirst({
        where: { folio: code, storeId },
        include: {
          sale: {
            include: {
              items: {
                include: { product: { select: { name: true } } },
              },
              user: { select: { id: true, name: true } },
            },
          },
          cliente: { select: { nombreRazonSocial: true, rfc: true } },
          user: { select: { id: true, name: true } },
        },
      });
      if (!factura) {
        throw ApiError.notFound(
          `No se encontró una factura con el folio ${code}`,
          'FACTURA_NOT_FOUND'
        );
      }
      return serializeEntity({
        entityType: 'FACTURA',
        entityId: factura.id,
        entityNumber: factura.folio,
        createdAt: factura.createdAt,
        status: factura.status,
        total: Number(factura.total),
        paymentMethod: factura.sale.paymentMethod,
        userId: factura.userId,
        userName: factura.user.name,
        itemCount: factura.sale.items.length,
        items: factura.sale.items.map((it) => ({
          productName: it.product.name,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          subtotal: Number(it.unitPrice) * Number(it.quantity),
        })),
      });
    }
    case 'SUPPLIER_TRANSACTION': {
      const tx = await prisma.supplierTransaction.findFirst({
        where: { id: code, storeId },
        include: {
          items: {
            include: { product: { select: { name: true } } },
          },
          supplier: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
        },
      });
      if (!tx) {
        throw ApiError.notFound(
          `No se encontró una compra a proveedor con el ID ${code}`,
          'SUPPLIER_TX_NOT_FOUND'
        );
      }
      return serializeEntity({
        entityType: 'SUPPLIER_TRANSACTION',
        entityId: tx.id,
        entityNumber: tx.id,
        createdAt: tx.createdAt,
        status: tx.status,
        total: Number(tx.total),
        paymentMethod: tx.paymentMethod,
        userId: tx.userId,
        userName: tx.user.name,
        supplierId: tx.supplierId,
        supplierName: tx.supplier.name,
        itemCount: tx.items.length,
        items: tx.items.map((it) => ({
          productName: it.product.name,
          quantity: Number(it.quantity),
          unitCost: Number(it.unitCost),
          subtotal: Number(it.unitCost) * Number(it.quantity),
        })),
      });
    }
    default:
      throw ApiError.badRequest('Tipo de entidad inválido', 'INVALID_ENTITY_TYPE');
  }
}

function validateWithinHours(createdAt: Date | string, maxHours: number = MAX_CANCELLATION_HOURS): { allowed: boolean; hoursLeft: number } {
  const now = new Date();
  const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const diffMs = now.getTime() - created.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const hoursLeft = Math.max(0, maxHours - diffHours);
  return { allowed: diffHours <= maxHours, hoursLeft };
}

export async function confirmCancellation(
  entityType: string,
  entityId: string,
  storeId: string,
  userId: string,
  reason: CancellationReason,
  comment?: string | null
) {
  return prisma.$transaction(async (tx) => {
    // Fetch the entity directly by its database ID (not by code)
    let entityNumber = '';
    let createdAt: Date;
    let total = new Prisma.Decimal(0);

    switch (entityType) {
      case 'SALE': {
        const sale = await tx.sale.findFirst({
          where: { id: entityId, storeId },
          include: { items: true },
        });
        if (!sale) {
          throw ApiError.notFound('Venta no encontrada', 'SALE_NOT_FOUND');
        }
        if (sale.status !== 'COMPLETED') {
          throw ApiError.badRequest('El documento ya fue cancelado o no está en estado activo', 'ALREADY_CANCELED');
        }
        entityNumber = sale.saleNumber;
        createdAt = sale.createdAt;
        total = sale.total;

        const { allowed, hoursLeft } = validateWithinHours(createdAt);
        if (!allowed) {
          throw ApiError.badRequest(
            `Solo se puede cancelar dentro de las ${MAX_CANCELLATION_HOURS} horas posteriores a la operación. Tiempo restante: ${hoursLeft.toFixed(1)} horas`,
            'CANCEL_WINDOW_EXPIRED'
          );
        }

        // Restore inventory
        for (const item of sale.items) {
          await tx.inventory.upsert({
            where: { storeId_productId: { storeId, productId: item.productId } },
            create: { storeId, productId: item.productId, quantity: item.quantity },
            update: { quantity: { increment: item.quantity } },
          });
        }

        await tx.sale.update({
          where: { id: entityId },
          data: {
            status: 'CANCELED',
            canceledAt: new Date(),
            canceledBy: userId,
            cancellationReason: reason,
            cancellationComment: comment ?? null,
          },
        });
        break;
      }
      case 'FACTURA': {
        const factura = await tx.factura.findFirst({
          where: { id: entityId, storeId },
        });
        if (!factura) {
          throw ApiError.notFound('Factura no encontrada', 'FACTURA_NOT_FOUND');
        }
        if (factura.status !== 'EMITIDA') {
          throw ApiError.badRequest('El documento ya fue cancelado o no está en estado activo', 'ALREADY_CANCELED');
        }
        entityNumber = factura.folio;
        createdAt = factura.createdAt;
        total = factura.total;

        const { allowed, hoursLeft } = validateWithinHours(createdAt, 72);
        if (!allowed) {
          throw ApiError.badRequest(
            `Solo se puede cancelar dentro de los 3 días (72 horas) posteriores a la emisión. Tiempo restante: ${hoursLeft.toFixed(1)} horas`,
            'CANCEL_WINDOW_EXPIRED'
          );
        }

        await tx.factura.update({
          where: { id: entityId },
          data: {
            status: 'CANCELADA',
            canceledAt: new Date(),
            canceledBy: userId,
            cancellationReason: reason,
            cancellationComment: comment ?? null,
          },
        });
        break;
      }
      case 'SUPPLIER_TRANSACTION': {
        const stx = await tx.supplierTransaction.findFirst({
          where: { id: entityId, storeId },
          include: { items: true },
        });
        if (!stx) {
          throw ApiError.notFound('Compra a proveedor no encontrada', 'SUPPLIER_TX_NOT_FOUND');
        }
        if (stx.status !== 'COMPLETED') {
          throw ApiError.badRequest('El documento ya fue cancelado o no está en estado activo', 'ALREADY_CANCELED');
        }
        entityNumber = stx.id;
        createdAt = stx.createdAt;
        total = stx.total;

        const { allowed, hoursLeft } = validateWithinHours(createdAt);
        if (!allowed) {
          throw ApiError.badRequest(
            `Solo se puede cancelar dentro de las ${MAX_CANCELLATION_HOURS} horas posteriores a la operación. Tiempo restante: ${hoursLeft.toFixed(1)} horas`,
            'CANCEL_WINDOW_EXPIRED'
          );
        }

        // Restore inventory (subtract what was added)
        for (const item of stx.items) {
          const inventory = await tx.inventory.findUnique({
            where: { storeId_productId: { storeId, productId: item.productId } },
          });
          if (inventory) {
            const newQty = inventory.quantity.minus(item.quantity);
            if (newQty.lessThan(0)) {
              throw ApiError.badRequest(
                'No se puede cancelar: el producto tendría stock negativo',
                'INSUFFICIENT_STOCK_TO_CANCEL'
              );
            }
            await tx.inventory.update({
              where: { storeId_productId: { storeId, productId: item.productId } },
              data: { quantity: { decrement: item.quantity } },
            });
          }
        }

        await tx.supplierTransaction.update({
          where: { id: entityId },
          data: {
            status: 'CANCELED',
            canceledAt: new Date(),
            canceledBy: userId,
            cancellationReason: reason,
            cancellationComment: comment ?? null,
          },
        });
        break;
      }
      default:
        throw ApiError.badRequest('Tipo de entidad inválido', 'INVALID_ENTITY_TYPE');
    }

    // Create Cancellation record
    const cancellation = await tx.cancellation.create({
      data: {
        storeId,
        userId,
        entityType,
        entityId,
        entityNumber,
        total,
        reason,
        comment: comment ?? null,
      },
    });

    // Audit log
    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: `CANCEL_${entityType}`,
        entity: entityType,
        entityId,
        metadata: {
          entityNumber,
          reason,
          comment: comment ?? null,
          cancellationId: cancellation.id,
        },
      },
    });

    return cancellation;
  });
}

export async function listCancellations(storeId: string, filters?: {
  startDate?: string;
  endDate?: string;
  entityType?: string;
  reason?: string;
}) {
  const where: Record<string, unknown> = { storeId };

  if (filters?.entityType) where.entityType = filters.entityType;
  if (filters?.reason) where.reason = filters.reason;

  if (filters?.startDate || filters?.endDate) {
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

  return prisma.cancellation.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}
