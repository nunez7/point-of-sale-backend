import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { emitToStore } from '../socket/socket';
import {
  PromotionConfig,
  PromotionResolution,
  PromotionTypeStr,
  calculatePromotions,
  toLite,
  CartLineInput,
} from './promotionCalculator';

export type PromotionTypeEnum = 'DIRECT_AMOUNT' | 'PERCENTAGE' | 'N_FOR_DISCOUNT' | 'N_FOR_FREE' | 'TIERED_BY_AMOUNT' | 'COMBO' | 'CATEGORY_PERCENTAGE';
export type WeekdayEnum = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export interface CreatePromotionInput {
  storeId: string;
  userId: string;
  name: string;
  description?: string | null;
  type: PromotionTypeStr;
  config: PromotionConfig;
  startsAt: Date;
  endsAt: Date;
  weekdays: string[];
  timeFrom: string | null;
  timeTo: string | null;
  isActive: boolean;
  priority: number;
  maxUses: number | null;
  items: Array<{
    productId?: string | null;
    categoryId?: string | null;
    comboPrice?: number | null;
  }>;
}

export interface UpdatePromotionInput {
  userId: string;
  name?: string;
  description?: string | null;
  type?: PromotionTypeStr;
  config?: PromotionConfig;
  startsAt?: Date;
  endsAt?: Date;
  weekdays?: string[];
  timeFrom?: string | null;
  timeTo?: string | null;
  isActive?: boolean;
  priority?: number;
  maxUses?: number | null;
  items?: Array<{
    productId?: string | null;
    categoryId?: string | null;
    comboPrice?: number | null;
  }>;
}

function validateConfig(type: PromotionTypeStr, config: PromotionConfig): void {
  if (config == null || typeof config !== 'object') {
    throw ApiError.badRequest('Configuración de promoción inválida', 'INVALID_PROMO_CONFIG');
  }
  switch (type) {
    case 'DIRECT_AMOUNT': {
      const c = config as { amount?: number };
      if (typeof c.amount !== 'number' || c.amount <= 0) {
        throw ApiError.badRequest('Monto directo debe ser > 0', 'INVALID_PROMO_CONFIG');
      }
      break;
    }
    case 'PERCENTAGE': {
      const c = config as { percent?: number };
      if (typeof c.percent !== 'number' || c.percent <= 0 || c.percent > 100) {
        throw ApiError.badRequest('Porcentaje debe estar entre 0 y 100', 'INVALID_PROMO_CONFIG');
      }
      break;
    }
    case 'N_FOR_DISCOUNT': {
      const c = config as {
        buyQuantity?: number;
        discountPercent?: number;
        appliesTo?: string;
      };
      if (typeof c.buyQuantity !== 'number' || c.buyQuantity < 2) {
        throw ApiError.badRequest('Cantidad de compra debe ser >= 2', 'INVALID_PROMO_CONFIG');
      }
      if (typeof c.discountPercent !== 'number' || c.discountPercent <= 0 || c.discountPercent > 100) {
        throw ApiError.badRequest('Porcentaje de descuento debe estar entre 0 y 100', 'INVALID_PROMO_CONFIG');
      }
      if (c.appliesTo !== 'EVERY_NTH' && c.appliesTo !== 'ALL_AFTER_N') {
        throw ApiError.badRequest('appliesTo debe ser EVERY_NTH o ALL_AFTER_N', 'INVALID_PROMO_CONFIG');
      }
      break;
    }
    case 'N_FOR_FREE': {
      const c = config as { buyQuantity?: number; freeQuantity?: number };
      if (typeof c.buyQuantity !== 'number' || c.buyQuantity < 1) {
        throw ApiError.badRequest('Cantidad de compra debe ser >= 1', 'INVALID_PROMO_CONFIG');
      }
      if (typeof c.freeQuantity !== 'number' || c.freeQuantity < 1) {
        throw ApiError.badRequest('Cantidad gratis debe ser >= 1', 'INVALID_PROMO_CONFIG');
      }
      break;
    }
    case 'TIERED_BY_AMOUNT': {
      const c = config as { tiers?: Array<{ minAmount?: number; percent?: number }> };
      if (!Array.isArray(c.tiers) || c.tiers.length === 0) {
        throw ApiError.badRequest('Debe definir al menos un nivel', 'INVALID_PROMO_CONFIG');
      }
      for (const t of c.tiers) {
        if (typeof t.minAmount !== 'number' || t.minAmount < 0) {
          throw ApiError.badRequest('minAmount debe ser >= 0', 'INVALID_PROMO_CONFIG');
        }
        if (typeof t.percent !== 'number' || t.percent <= 0 || t.percent > 100) {
          throw ApiError.badRequest('percent debe estar entre 0 y 100', 'INVALID_PROMO_CONFIG');
        }
      }
      break;
    }
    case 'COMBO': {
      const c = config as { comboPrice?: number; discountPercent?: number };
      if (c.comboPrice == null && c.discountPercent == null) {
        throw ApiError.badRequest(
          'Combo debe definir comboPrice o discountPercent',
          'INVALID_PROMO_CONFIG'
        );
      }
      if (c.comboPrice != null && c.comboPrice <= 0) {
        throw ApiError.badRequest('comboPrice debe ser > 0', 'INVALID_PROMO_CONFIG');
      }
      if (c.discountPercent != null && (c.discountPercent <= 0 || c.discountPercent > 100)) {
        throw ApiError.badRequest('discountPercent debe estar entre 0 y 100', 'INVALID_PROMO_CONFIG');
      }
      break;
    }
    case 'CATEGORY_PERCENTAGE': {
      const c = config as { percent?: number };
      if (typeof c.percent !== 'number' || c.percent <= 0 || c.percent > 100) {
        throw ApiError.badRequest('Porcentaje debe estar entre 0 y 100', 'INVALID_PROMO_CONFIG');
      }
      break;
    }
  }
}

function validateItems(type: PromotionTypeStr, items: CreatePromotionInput['items']): void {
  if (type === 'CATEGORY_PERCENTAGE') {
    const cats = items.map((i) => i.categoryId).filter(Boolean);
    if (cats.length === 0) {
      throw ApiError.badRequest('Debe seleccionar al menos una categoría', 'INVALID_PROMO_ITEMS');
    }
    return;
  }
  if (type === 'TIERED_BY_AMOUNT') {
    return; // sin items
  }
  const products = items.map((i) => i.productId).filter(Boolean);
  if (type === 'COMBO' && products.length < 2) {
    throw ApiError.badRequest('Combo debe incluir al menos 2 productos', 'INVALID_PROMO_ITEMS');
  }
  if (products.length === 0) {
    throw ApiError.badRequest('Debe seleccionar al menos un producto', 'INVALID_PROMO_ITEMS');
  }
}

function validateWeekdays(weekdays: string[]): void {
  const valid = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  for (const w of weekdays) {
    if (!valid.includes(w)) {
      throw ApiError.badRequest(`Día inválido: ${w}`, 'INVALID_PROMO_WEEKDAYS');
    }
  }
}

export async function listPromotions(filters: {
  storeId: string;
  isActive?: boolean;
  type?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const where: Prisma.PromotionWhereInput = { storeId: filters.storeId };
  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.type) where.type = filters.type as Prisma.PromotionWhereInput['type'];
  if (filters.search) {
    where.name = { contains: filters.search, mode: 'insensitive' };
  }

  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 50;
  const skip = (page - 1) * pageSize;

  const [items, total] = await Promise.all([
    prisma.promotion.findMany({
      where,
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, sellingPrice: true } },
            category: { select: { id: true, name: true } },
          },
        },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: pageSize,
    }),
    prisma.promotion.count({ where }),
  ]);

  return {
    items: items.map(serializePromotion),
    total,
    page,
    pageSize,
  };
}

export async function getPromotion(id: string, storeId: string) {
  const promo = await prisma.promotion.findFirst({
    where: { id, storeId },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, sellingPrice: true } },
          category: { select: { id: true, name: true } },
        },
      },
      createdBy: { select: { id: true, name: true } },
    },
  });
  return promo ? serializePromotion(promo) : null;
}

export async function createPromotion(input: CreatePromotionInput) {
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw ApiError.badRequest(
      'La fecha de fin debe ser posterior al inicio',
      'INVALID_PROMO_DATES'
    );
  }
  validateConfig(input.type, input.config);
  validateItems(input.type, input.items);
  validateWeekdays(input.weekdays);

  // Verifica que los productos pertenezcan a la tienda
  const productIds = input.items.map((i) => i.productId).filter(Boolean) as string[];
  if (productIds.length > 0) {
    const found = await prisma.product.count({
      where: { id: { in: productIds }, storeId: input.storeId },
    });
    if (found !== new Set(productIds).size) {
      throw ApiError.badRequest('Uno o más productos no pertenecen a esta tienda', 'INVALID_PRODUCT');
    }
  }
  // Verifica categorías
  const categoryIds = input.items.map((i) => i.categoryId).filter(Boolean) as string[];
  if (categoryIds.length > 0) {
    const found = await prisma.category.count({
      where: { id: { in: categoryIds }, storeId: input.storeId },
    });
    if (found !== new Set(categoryIds).size) {
      throw ApiError.badRequest('Una o más categorías no pertenecen a esta tienda', 'INVALID_CATEGORY');
    }
  }

  const promo = await prisma.promotion.create({
    data: {
      storeId: input.storeId,
      name: input.name.trim(),
      description: input.description ?? null,
      type: input.type,
      config: input.config as Prisma.InputJsonValue,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      weekdays: (input.weekdays ?? []) as WeekdayEnum[],
      timeFrom: input.timeFrom,
      timeTo: input.timeTo,
      isActive: input.isActive,
      priority: input.priority,
      maxUses: input.maxUses,
      usesCount: 0,
      createdById: input.userId,
      items: {
        create: input.items.map((i) => ({
          productId: i.productId ?? null,
          categoryId: i.categoryId ?? null,
          comboPrice: i.comboPrice ?? null,
        })),
      },
    },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, sellingPrice: true } },
          category: { select: { id: true, name: true } },
        },
      },
      createdBy: { select: { id: true, name: true } },
    },
  });

  await audit({
    storeId: input.storeId,
    userId: input.userId,
    action: 'PROMOTION_CREATED',
    entity: 'PROMOTION',
    entityId: promo.id,
    metadata: { name: promo.name, type: promo.type },
  });

  emitToStore(input.storeId, 'promotion:created', { id: promo.id });

  return serializePromotion(promo);
}

export async function updatePromotion(
  id: string,
  storeId: string,
  input: UpdatePromotionInput
) {
  const existing = await prisma.promotion.findFirst({ where: { id, storeId } });
  if (!existing) {
    throw ApiError.notFound('Promoción no encontrada', 'PROMOTION_NOT_FOUND');
  }
  const nextType = (input.type ?? (existing.type as PromotionTypeStr)) as PromotionTypeStr;
  const nextConfig = (input.config ?? (existing.config as PromotionConfig)) as PromotionConfig;
  if (input.type || input.config) {
    validateConfig(nextType, nextConfig);
  }
  if (input.items) {
    validateItems(nextType, input.items);
  }
  if (input.weekdays) {
    validateWeekdays(input.weekdays);
  }
  const startsAt = input.startsAt ?? existing.startsAt;
  const endsAt = input.endsAt ?? existing.endsAt;
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw ApiError.badRequest('La fecha de fin debe ser posterior al inicio', 'INVALID_PROMO_DATES');
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.items) {
      await tx.promotionItem.deleteMany({ where: { promotionId: id } });
    }
    return tx.promotion.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.config ? { config: input.config as Prisma.InputJsonValue } : {}),
        ...(input.startsAt ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt ? { endsAt: input.endsAt } : {}),
        ...(input.weekdays ? { weekdays: input.weekdays as WeekdayEnum[] } : {}),
        ...(input.timeFrom !== undefined ? { timeFrom: input.timeFrom } : {}),
        ...(input.timeTo !== undefined ? { timeTo: input.timeTo } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.maxUses !== undefined ? { maxUses: input.maxUses } : {}),
        ...(input.items
          ? {
              items: {
                create: input.items.map((i) => ({
                  productId: i.productId ?? null,
                  categoryId: i.categoryId ?? null,
                  comboPrice: i.comboPrice ?? null,
                })),
              },
            }
          : {}),
      },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, sellingPrice: true } },
            category: { select: { id: true, name: true } },
          },
        },
        createdBy: { select: { id: true, name: true } },
      },
    });
  });

  await audit({
    storeId,
    userId: input.userId,
    action: 'PROMOTION_UPDATED',
    entity: 'PROMOTION',
    entityId: id,
    metadata: { name: updated.name },
  });

  emitToStore(storeId, 'promotion:updated', { id });
  return serializePromotion(updated);
}

export async function togglePromotion(
  id: string,
  storeId: string,
  userId: string,
  isActive: boolean
) {
  const existing = await prisma.promotion.findFirst({ where: { id, storeId } });
  if (!existing) {
    throw ApiError.notFound('Promoción no encontrada', 'PROMOTION_NOT_FOUND');
  }
  const updated = await prisma.promotion.update({
    where: { id },
    data: { isActive },
  });
  await audit({
    storeId,
    userId,
    action: isActive ? 'PROMOTION_ACTIVATED' : 'PROMOTION_DEACTIVATED',
    entity: 'PROMOTION',
    entityId: id,
  });
  emitToStore(storeId, 'promotion:updated', { id });
  return { id: updated.id, isActive: updated.isActive };
}

export async function deletePromotion(id: string, storeId: string, userId: string) {
  const existing = await prisma.promotion.findFirst({ where: { id, storeId } });
  if (!existing) {
    throw ApiError.notFound('Promoción no encontrada', 'PROMOTION_NOT_FOUND');
  }
  // Soft delete: desactivar (preserva historial de PromotionApplication).
  await prisma.promotion.update({
    where: { id },
    data: { isActive: false, endsAt: new Date() },
  });
  await audit({
    storeId,
    userId,
    action: 'PROMOTION_DELETED',
    entity: 'PROMOTION',
    entityId: id,
  });
  emitToStore(storeId, 'promotion:deleted', { id });
  return { id };
}

/** Carga las promos aplicables (vigentes y activas) para el POS. */
export async function getApplicablePromotionsForPos(storeId: string) {
  const now = new Date();
  const promos = await prisma.promotion.findMany({
    where: {
      storeId,
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
      OR: [{ maxUses: null }, { usesCount: { lt: prisma.promotion.fields.maxUses as never } }],
    },
    include: { items: true },
  });
  // El filtro `usesCount < maxUses` no es trivial con Prisma; lo aplicamos en JS.
  return promos
    .filter((p) => p.maxUses == null || p.usesCount < p.maxUses)
    .map(toLite);
}

/** Vista previa del descuento sobre un carrito (sin persistir). */
export async function previewPromotions(input: {
  storeId: string;
  items: Array<{
    productId: string;
    quantity: number;
    /** Precio unitario que el cliente enviaría como "normal" (opcional;
     * si no se envía, se toma del producto). */
    unitPrice?: number;
  }>;
}) {
  const productIds = input.items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, storeId: input.storeId, isActive: true },
  });
  if (products.length !== new Set(productIds).size) {
    throw ApiError.badRequest('Uno o más productos no existen en esta tienda', 'PRODUCT_NOT_FOUND');
  }
  const productMap = new Map(products.map((p) => [p.id, p]));

  const lines: CartLineInput[] = input.items.map((it) => {
    const p = productMap.get(it.productId);
    if (!p) throw ApiError.badRequest('Producto no encontrado', 'PRODUCT_NOT_FOUND');
    return {
      productId: it.productId,
      unitPrice: it.unitPrice ?? Number(p.sellingPrice),
      quantity: it.quantity,
      categoryId: p.categoryId,
      costPrice: Number(p.costPrice),
    };
  });

  const promos = await getApplicablePromotionsForPos(input.storeId);
  return calculatePromotions(lines, promos);
}

/** Resuelve promos para una venta. Usado dentro de la transacción. */
export async function resolvePromotionsForSale(
  tx: Prisma.TransactionClient,
  storeId: string,
  lines: CartLineInput[]
): Promise<PromotionResolution> {
  const now = new Date();
  const promos = await tx.promotion.findMany({
    where: {
      storeId,
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    include: { items: true },
  });
  const litePromos = promos
    .filter((p) => p.maxUses == null || p.usesCount < p.maxUses)
    .map(toLite);
  return calculatePromotions(lines, litePromos, now);
}

/** Aplica la resolución a la venta: actualiza useCount, crea PromotionApplication. */
export async function applyPromotionResolutionToSaleTx(
  tx: Prisma.TransactionClient,
  saleId: string,
  storeId: string,
  resolution: PromotionResolution
) {
  for (const app of resolution.applied) {
    // Verifica maxUses atómicamente
    const updated = await tx.promotion.updateMany({
      where: {
        id: app.promotionId,
        storeId,
        OR: [{ maxUses: null }, { usesCount: { lt: 0 } }],
      },
      data: { usesCount: { increment: 1 } },
    });
    // Si no se actualizó (por maxUses), validar manualmente
    if (updated.count === 0) {
      const promo = await tx.promotion.findUnique({ where: { id: app.promotionId } });
      if (promo && promo.maxUses != null && promo.usesCount >= promo.maxUses) {
        // La promo alcanzó su máximo; abortar la venta
        throw ApiError.badRequest(
          `La promoción "${promo.name}" alcanzó su máximo de usos`,
          'PROMOTION_MAX_USES'
        );
      }
      // Si por alguna razón no actualizó, intenta de nuevo
      await tx.promotion.update({
        where: { id: app.promotionId },
        data: { usesCount: { increment: 1 } },
      });
    }
    await tx.promotionApplication.create({
      data: {
        storeId,
        promotionId: app.promotionId,
        saleId,
        productId: app.productId,
        originalAmount: app.originalAmount,
        discountedAmount: app.discountedAmount,
        savedAmount: app.savedAmount,
        details: app.details as Prisma.InputJsonValue,
      },
    });
  }
}

/** Revierte las aplicaciones de una venta cancelada. */
export async function revertPromotionApplicationsForSale(
  tx: Prisma.TransactionClient,
  saleId: string
) {
  const apps = await tx.promotionApplication.findMany({ where: { saleId } });
  for (const app of apps) {
    await tx.promotion.update({
      where: { id: app.promotionId },
      data: { usesCount: { decrement: 1 } },
    });
  }
  await tx.promotionApplication.deleteMany({ where: { saleId } });
}

/** Reporte agregado de promos. */
export async function getPromotionReport(filters: {
  storeId: string;
  startDate?: string;
  endDate?: string;
  type?: string;
  promotionId?: string;
}) {
  const where: Prisma.PromotionApplicationWhereInput = { storeId: filters.storeId };
  if (filters.promotionId) where.promotionId = filters.promotionId;
  if (filters.type) where.promotion = { type: filters.type } as any;
  if (filters.startDate || filters.endDate) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.startDate) {
      createdAt.gte = new Date(`${filters.startDate}T00:00:00.000Z`);
    }
    if (filters.endDate) {
      createdAt.lte = new Date(`${filters.endDate}T23:59:59.999Z`);
    }
    where.createdAt = createdAt;
  }

  const [apps, allPromos, summary] = await Promise.all([
    prisma.promotionApplication.findMany({
      where,
      include: {
        promotion: {
          select: {
            id: true,
            name: true,
            type: true,
            startsAt: true,
            endsAt: true,
            isActive: true,
          },
        },
        product: { select: { id: true, name: true, sku: true, costPrice: true, sellingPrice: true } },
        sale: { select: { id: true, saleNumber: true, createdAt: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.promotion.findMany({
      where: { storeId: filters.storeId },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, costPrice: true, sellingPrice: true } },
            category: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.promotionApplication.aggregate({
      where,
      _count: { _all: true },
      _sum: { originalAmount: true, discountedAmount: true, savedAmount: true },
    }),
  ]);

  // Filtra aplicaciones de ventas canceladas (status !== CANCELED)
  const validApps = apps.filter((a) => a.sale.status !== 'CANCELED');

  const now = new Date();
  const promoStatus = (p: { startsAt: Date; endsAt: Date; isActive: boolean }) => {
    if (!p.isActive) return 'INACTIVE';
    if (p.endsAt.getTime() < now.getTime()) return 'EXPIRED';
    if (p.startsAt.getTime() > now.getTime()) return 'PENDING';
    return 'ACTIVE';
  };

  return {
    summary: {
      totalApplications: summary._count._all,
      totalSalesWithPromo: new Set(validApps.map((a) => a.saleId)).size,
      totalOriginalAmount: Number(summary._sum.originalAmount ?? 0),
      totalDiscountedAmount: Number(summary._sum.discountedAmount ?? 0),
      totalSaved: Number(summary._sum.savedAmount ?? 0),
    },
    applications: validApps.map((a) => ({
      id: a.id,
      promotionId: a.promotionId,
      promotionName: a.promotion.name,
      promotionType: a.promotion.type,
      saleId: a.saleId,
      saleNumber: a.sale.saleNumber,
      saleDate: a.sale.createdAt,
      productId: a.productId,
      productName: a.product?.name ?? null,
      productSku: a.product?.sku ?? null,
      productCost: a.product ? Number(a.product.costPrice) : null,
      productPrice: a.product ? Number(a.product.sellingPrice) : null,
      originalAmount: Number(a.originalAmount),
      discountedAmount: Number(a.discountedAmount),
      savedAmount: Number(a.savedAmount),
      createdAt: a.createdAt,
    })),
    promotions: allPromos.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      status: promoStatus(p),
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      isActive: p.isActive,
      priority: p.priority,
      maxUses: p.maxUses,
      usesCount: p.usesCount,
      items: p.items.map((i) => ({
        productId: i.productId,
        productName: i.product?.name ?? null,
        productSku: i.product?.sku ?? null,
        productCost: i.product ? Number(i.product.costPrice) : null,
        productPrice: i.product ? Number(i.product.sellingPrice) : null,
        categoryId: i.categoryId,
        categoryName: i.category?.name ?? null,
        comboPrice: i.comboPrice == null ? null : Number(i.comboPrice),
      })),
      createdAt: p.createdAt,
    })),
  };
}

type FullPromotion = Prisma.PromotionGetPayload<{
  include: {
    items: {
      include: {
        product: { select: { id: true; name: true; sku: true; sellingPrice: true } };
        category: { select: { id: true; name: true } };
      };
    };
    createdBy: { select: { id: true; name: true } };
  };
}>;

function serializePromotion(p: FullPromotion) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    type: p.type as PromotionTypeStr,
    config: p.config as PromotionConfig,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    weekdays: p.weekdays,
    timeFrom: p.timeFrom,
    timeTo: p.timeTo,
    isActive: p.isActive,
    priority: p.priority,
    maxUses: p.maxUses,
    usesCount: p.usesCount,
    items: p.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.product?.name ?? null,
      productSku: i.product?.sku ?? null,
      productPrice: i.product ? Number(i.product.sellingPrice) : null,
      categoryId: i.categoryId,
      categoryName: i.category?.name ?? null,
      comboPrice: i.comboPrice == null ? null : Number(i.comboPrice),
    })),
    createdBy: p.createdBy,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// Re-exports para uso interno
export { calculatePromotions };
