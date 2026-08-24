import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { colombiaStartOfDay, colombiaEndOfDay } from '../utils/dates';
import { createSupplierCancelMovementsInTx } from './stockMovement.service';

const MAX_CANCELLATION_HOURS = 24;

interface EntityItem {
  id: string;
  productName: string;
  quantity: number;
  unitPrice?: number;
  unitCost?: number;
  unidad?: string | null;
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
  facturaStatus?: string | null;
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
      id: it.id,
      productName: it.productName,
      quantity: Number(it.quantity),
      unitPrice: it.unitPrice != null ? Number(it.unitPrice) : undefined,
      unitCost: it.unitCost != null ? Number(it.unitCost) : undefined,
      unidad: it.unidad ?? undefined,
      subtotal: Number(it.subtotal),
    })),
  };
}

export async function getEntityDetails(
  entityType: string,
  entityId: string,
  storeId: string
): Promise<EntityInfo | null> {
  switch (entityType) {
    case 'SALE': {
      const sale = await prisma.sale.findFirst({
        where: { id: entityId, storeId },
        include: {
          items: {
            include: { product: { select: { name: true } } },
          },
          user: { select: { id: true, name: true } },
          factura: { select: { id: true, status: true } },
        },
      });
      if (!sale) return null;
      const subtotal = (it: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }) =>
        Number(it.unitPrice) * Number(it.quantity);
      return {
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
        facturaStatus: sale.factura?.status ?? null,
        itemCount: sale.items.length,
        items: sale.items.map((it) => ({
          id: it.id,
          productName: it.product.name,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          unidad: it.unidad,
          subtotal: subtotal(it),
        })),
      };
    }
    case 'FACTURA': {
      const factura = await prisma.factura.findFirst({
        where: { id: entityId, storeId },
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
      if (!factura) return null;
      const subtotal = (it: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }) =>
        Number(it.unitPrice) * Number(it.quantity);
      return {
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
          id: it.id,
          productName: it.product.name,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          unidad: it.unidad,
          subtotal: subtotal(it),
        })),
      };
    }
    case 'SUPPLIER_TRANSACTION': {
      const tx = await prisma.supplierTransaction.findFirst({
        where: { id: entityId, storeId },
        include: {
          items: {
            include: { product: { select: { name: true } } },
          },
          supplier: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
        },
      });
      if (!tx) return null;
      const subtotal = (it: { quantity: Prisma.Decimal; unitCost: Prisma.Decimal }) =>
        Number(it.unitCost) * Number(it.quantity);
      return {
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
          id: it.id,
          productName: it.product.name,
          quantity: Number(it.quantity),
          unitCost: Number(it.unitCost),
          subtotal: subtotal(it),
        })),
      };
    }
    default:
      return null;
  }
}

async function assertEntityFound(entity: EntityInfo | null, entityType: string) {
  if (!entity) {
    switch (entityType) {
      case 'SALE':
        throw ApiError.notFound('No se encontró una venta con ese número', 'SALE_NOT_FOUND');
      case 'FACTURA':
        throw ApiError.notFound('No se encontró una factura con ese folio', 'FACTURA_NOT_FOUND');
      default:
        throw ApiError.notFound(
          'No se encontró una compra a proveedor con ese ID',
          'SUPPLIER_TX_NOT_FOUND'
        );
    }
  }
  return entity;
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
          items: { include: { product: { select: { name: true } } } },
          user: { select: { id: true, name: true } },
          factura: { select: { id: true, status: true } },
        },
      });
      const entity = await getEntityDetails('SALE', sale?.id ?? '', storeId);
      return serializeEntity(await assertEntityFound(entity, 'SALE'));
    }
    case 'FACTURA': {
      const factura = await prisma.factura.findFirst({
        where: { folio: code, storeId },
      });
      const entity = await getEntityDetails('FACTURA', factura?.id ?? '', storeId);
      return serializeEntity(await assertEntityFound(entity, 'FACTURA'));
    }
    case 'SUPPLIER_TRANSACTION': {
      const entity = await getEntityDetails('SUPPLIER_TRANSACTION', code, storeId);
      return serializeEntity(await assertEntityFound(entity, 'SUPPLIER_TRANSACTION'));
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

export interface CancelItemInput {
  saleItemId: string;
  quantity: number;
}

export async function confirmCancellation(
  entityType: string,
  entityId: string,
  storeId: string,
  userId: string,
  cancellationReasonId: string,
  comment?: string | null,
  items?: CancelItemInput[]
) {
  // Validar que el motivo exista y pertenezca a la tienda
  const reasonRecord = await prisma.cancellationReason.findFirst({
    where: { id: cancellationReasonId, storeId },
  });
  if (!reasonRecord) {
    throw ApiError.notFound('Motivo de cancelación no encontrado', 'REASON_NOT_FOUND');
  }

  return prisma.$transaction(async (tx) => {
    let entityNumber = '';
    let createdAt: Date;
    let total = new Prisma.Decimal(0);
    let cancellationType: 'FULL' | 'PARTIAL' = 'FULL';
    const cancellationItems: Prisma.CancellationItemCreateWithoutCancellationInput[] = [];

    switch (entityType) {
      case 'SALE': {
        const sale = await tx.sale.findFirst({
          where: { id: entityId, storeId },
          include: {
            items: { include: { product: { select: { name: true } } } },
            factura: { select: { id: true, status: true } },
          },
        });
        if (!sale) {
          throw ApiError.notFound('Venta no encontrada', 'SALE_NOT_FOUND');
        }
        if (sale.status !== 'COMPLETED') {
          throw ApiError.badRequest('El documento ya fue cancelado o no está en estado activo', 'ALREADY_CANCELED');
        }

        // No se puede cancelar una venta con factura emitida (ni parcial ni completa).
        if (sale.factura && sale.factura.status !== 'CANCELED') {
          throw ApiError.badRequest(
            'No se puede cancelar la venta: tiene una factura emitida. Cancele primero la factura.',
            'SALE_HAS_ACTIVE_INVOICE'
          );
        }

        entityNumber = sale.saleNumber;
        createdAt = sale.createdAt;

        const { allowed, hoursLeft } = validateWithinHours(createdAt);
        if (!allowed) {
          throw ApiError.badRequest(
            `Solo se puede cancelar dentro de las ${MAX_CANCELLATION_HOURS} horas posteriores a la operación. Tiempo restante: ${hoursLeft.toFixed(1)} horas`,
            'CANCEL_WINDOW_EXPIRED'
          );
        }

        const isPartial = !!items && items.length > 0;

        if (isPartial) {
          cancellationType = 'PARTIAL';

          // Cantidad ya cancelada por artículo (cancelaciones parciales previas)
          const itemIds = items!.map((i) => i.saleItemId);
          const prevCanceled = await tx.cancellationItem.groupBy({
            by: ['saleItemId'],
            where: { saleItemId: { in: itemIds } },
            _sum: { quantity: true },
          });
          const prevMap = new Map(prevCanceled.map((p) => [p.saleItemId, p._sum.quantity ?? new Prisma.Decimal(0)]));

          const saleItemMap = new Map(sale.items.map((it) => [it.id, it]));

          for (const sel of items!) {
            const saleItem = saleItemMap.get(sel.saleItemId);
            if (!saleItem) {
              throw ApiError.badRequest('Un artículo seleccionado no pertenece a la venta', 'INVALID_ITEM');
            }
            const qty = new Prisma.Decimal(sel.quantity);
            if (qty.lte(0)) {
              throw ApiError.badRequest('La cantidad a cancelar debe ser mayor a 0', 'INVALID_QUANTITY');
            }
            const disponible = saleItem.quantity.minus(prevMap.get(sel.saleItemId) ?? new Prisma.Decimal(0));
            if (qty.gt(disponible)) {
              throw ApiError.badRequest(
                `Solo quedan ${disponible.toString()} disponibles para cancelar de "${saleItem.product.name}"`,
                'INSUFFICIENT_TO_CANCEL'
              );
            }

            // Restaurar inventario solo de este artículo
            await tx.inventory.upsert({
              where: { storeId_productId: { storeId, productId: saleItem.productId } },
              create: { storeId, productId: saleItem.productId, quantity: qty },
              update: { quantity: { increment: qty } },
            });

            const itemTotal = qty.mul(saleItem.unitPrice);
            total = total.plus(itemTotal);

            cancellationItems.push({
              storeId,
              saleItemId: saleItem.id,
              productId: saleItem.productId,
              productName: saleItem.product.name,
              quantity: qty,
              unidad: saleItem.unidad,
              unitPrice: saleItem.unitPrice,
              costPrice: saleItem.costPrice,
              profit: qty.mul(saleItem.profit),
              subtotal: itemTotal,
            });

            // Marcar el artículo si queda totalmente cancelado
            const totalCanceled = (prevMap.get(sel.saleItemId) ?? new Prisma.Decimal(0)).plus(qty);
            if (totalCanceled.gte(saleItem.quantity)) {
              await tx.saleItem.update({
                where: { id: saleItem.id },
                data: { canceledAt: new Date(), canceledBy: userId },
              });
            }
          }

          // La venta permanece COMPLETADA; no se marca como cancelada.
        } else {
          // Cancelación total: restaurar todo el inventario y marcar la venta.
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
              cancellationReasonId,
              cancellationComment: comment ?? null,
            },
          });
          total = sale.total;
        }
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
            status: 'CANCELED',
            canceledAt: new Date(),
            canceledBy: userId,
            cancellationReasonId,
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

        // Restaurar inventario (salida inversa) y registrar el movimiento de
        // SALIDA vinculado a la compra (referenceType/referenceId = SUPPLIER_TX).
        await createSupplierCancelMovementsInTx(tx, {
          storeId,
          userId,
          referenceId: stx.id,
          items: stx.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitCost: i.unitCost,
          })),
        });

        await tx.supplierTransaction.update({
          where: { id: entityId },
          data: {
            status: 'CANCELED',
            canceledAt: new Date(),
            canceledBy: userId,
            cancellationReasonId,
            cancellationComment: comment ?? null,
          },
        });
        break;
      }
      default:
        throw ApiError.badRequest('Tipo de entidad inválido', 'INVALID_ENTITY_TYPE');
    }

    // Crear registro de Cancelación
    const cancellation = await tx.cancellation.create({
      data: {
        storeId,
        userId,
        entityType,
        entityId,
        entityNumber,
        total,
        type: cancellationType,
        cancellationReasonId,
        comment: comment ?? null,
        items: cancellationItems.length ? { create: cancellationItems } : undefined,
      },
      include: { cancellationReason: true, items: true },
    });

    // Marcar el cancellationId en los artículos de venta totalmente cancelados
    if (cancellationItems.length) {
      const created = await tx.cancellationItem.findMany({
        where: { cancellationId: cancellation.id },
        select: { id: true, saleItemId: true },
      });
      const bySaleItem = new Map(created.map((c) => [c.saleItemId, c.id]));
      for (const it of cancellationItems) {
        const cancellationItemId = bySaleItem.get(it.saleItemId);
        if (cancellationItemId) {
          await tx.saleItem.update({
            where: { id: it.saleItemId },
            data: { cancellationId: cancellationItemId },
          });
        }
      }
    }

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
          type: cancellationType,
          cancellationReasonId,
          comment: comment ?? null,
          cancellationId: cancellation.id,
        },
      },
    });

    const entityDetails = await getEntityDetails(entityType, entityId, storeId);

    return {
      ...cancellation,
      reason: cancellation.cancellationReason?.name ?? '—',
      entityDetails: entityDetails ? serializeEntity(entityDetails) : null,
    };
  });
}

export async function listCancellations(storeId: string, filters?: {
  startDate?: string;
  endDate?: string;
  entityType?: string;
  cancellationReasonId?: string;
  type?: 'FULL' | 'PARTIAL';
}) {
  const where: Record<string, unknown> = { storeId };

  if (filters?.entityType) where.entityType = filters.entityType;
  if (filters?.cancellationReasonId) where.cancellationReasonId = filters.cancellationReasonId;
  if (filters?.type) where.type = filters.type;

  if (filters?.startDate || filters?.endDate) {
    const createdAt: Record<string, Date> = {};
    if (filters.startDate) createdAt.gte = colombiaStartOfDay(filters.startDate);
    if (filters.endDate) createdAt.lte = colombiaEndOfDay(filters.endDate);
    if (Object.keys(createdAt).length) where.createdAt = createdAt;
  }

  const cancellations = await prisma.cancellation.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true } },
      cancellationReason: true,
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const withDetails = await Promise.all(
    cancellations.map(async (c) => {
      const entityDetails = await getEntityDetails(c.entityType, c.entityId, storeId);
      return {
        ...c,
        reason: c.cancellationReason?.name ?? '—',
        entityDetails: entityDetails ? serializeEntity(entityDetails) : null,
      };
    })
  );

  return withDetails;
}
