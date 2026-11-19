import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { prismaMock } from '../helpers/prismaMock';
import { dec } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import { emitToStore } from '../../src/socket/socket';
import {
  applyPromotionResolutionToSaleTx,
  calculatePromotions,
  createPromotion,
  deletePromotion,
  getApplicablePromotionsForPos,
  getPromotion,
  getPromotionReport,
  listPromotions,
  previewPromotions,
  resolvePromotionsForSale,
  revertPromotionApplicationsForSale,
  togglePromotion,
  updatePromotion,
} from '../../src/services/promotion.service';
import type {
  CreatePromotionInput,
  UpdatePromotionInput,
} from '../../src/services/promotion.service';
import * as calculator from '../../src/services/promotionCalculator';
import type {
  AppliedPromotion,
  CartLineInput,
  PromotionConfig,
  PromotionResolution,
  PromotionTypeStr,
} from '../../src/services/promotionCalculator';

// ───────────────────────────────────────────────────────────────────────────
// Utilidades y builders locales
// ───────────────────────────────────────────────────────────────────────────

const AHORA = new Date('2026-01-15T18:00:00.000Z');
const INICIO = new Date('2026-01-01T00:00:00.000Z');
const FIN = new Date('2026-12-31T23:59:59.000Z');

afterEach(() => {
  vi.useRealTimers();
});

function fijarAhora(): void {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
}

interface PromotionItemFullRow {
  id: string;
  promotionId: string;
  productId: string | null;
  categoryId: string | null;
  comboPrice: Prisma.Decimal | null;
  product: { id: string; name: string; sku: string | null; sellingPrice: Prisma.Decimal } | null;
  category: { id: string; name: string } | null;
}

function itemFull(overrides: Partial<PromotionItemFullRow> = {}): PromotionItemFullRow {
  return {
    id: 'promoitem-1',
    promotionId: 'promo-1',
    productId: 'product-1',
    categoryId: null,
    comboPrice: null,
    product: { id: 'product-1', name: 'Refresco 600ml', sku: 'SKU-001', sellingPrice: dec('15.00') },
    category: null,
    ...overrides,
  };
}

interface PromotionFullRow {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
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
  usesCount: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  items: PromotionItemFullRow[];
  createdBy: { id: string; name: string };
}

/** Fila de Promotion con la forma que devuelven las consultas del servicio. */
function promotionFull(overrides: Partial<PromotionFullRow> = {}): PromotionFullRow {
  return {
    id: 'promo-1',
    storeId: 'store-1',
    name: 'Promo de prueba',
    description: null,
    type: 'PERCENTAGE',
    config: { percent: 10 },
    startsAt: INICIO,
    endsAt: FIN,
    weekdays: ['MONDAY'],
    timeFrom: null,
    timeTo: null,
    isActive: true,
    priority: 0,
    maxUses: null,
    usesCount: 0,
    createdById: 'user-1',
    createdAt: AHORA,
    updatedAt: AHORA,
    items: [itemFull()],
    createdBy: { id: 'user-1', name: 'Gerente de Prueba' },
    ...overrides,
  };
}

/** Fila de Promotion con sólo `items` (lo que necesita `toLite`). */
function promotionLite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'promo-1',
    storeId: 'store-1',
    name: 'Promo de prueba',
    description: null,
    type: 'PERCENTAGE',
    config: { percent: 10 },
    startsAt: INICIO,
    endsAt: FIN,
    weekdays: [],
    timeFrom: null,
    timeTo: null,
    isActive: true,
    priority: 0,
    maxUses: null,
    usesCount: 0,
    createdById: 'user-1',
    createdAt: AHORA,
    updatedAt: AHORA,
    items: [
      { id: 'promoitem-1', promotionId: 'promo-1', productId: 'product-1', categoryId: null, comboPrice: null },
    ],
    ...overrides,
  };
}

function entradaCreacion(overrides: Partial<CreatePromotionInput> = {}): CreatePromotionInput {
  return {
    storeId: 'store-1',
    userId: 'user-1',
    name: '  Promo verano  ',
    description: null,
    type: 'PERCENTAGE',
    config: { percent: 10 },
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: new Date('2026-02-01T00:00:00.000Z'),
    weekdays: [],
    timeFrom: null,
    timeTo: null,
    isActive: true,
    priority: 0,
    maxUses: null,
    items: [{ productId: 'product-1' }],
    ...overrides,
  };
}

function datosDe(mock: { mock: { calls: unknown[][] } }, indice = 0): any {
  return mock.mock.calls[indice]?.[0] as any;
}

/** Deja `createPromotion` listo para un camino feliz. */
function prepararCreacion(productos = 1, categorias = 0): void {
  prismaMock.product.count.mockResolvedValue(productos);
  prismaMock.category.count.mockResolvedValue(categorias);
  prismaMock.promotion.create.mockResolvedValue(promotionFull());
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
}

// ───────────────────────────────────────────────────────────────────────────
// listPromotions
// ───────────────────────────────────────────────────────────────────────────

describe('listPromotions', () => {
  it('sin filtros usa la primera página y 50 registros', async () => {
    prismaMock.promotion.findMany.mockResolvedValue([promotionFull()]);
    prismaMock.promotion.count.mockResolvedValue(1);

    const resultado = await listPromotions({ storeId: 'store-1' });

    const args = datosDe(prismaMock.promotion.findMany);
    expect(args.where).toEqual({ storeId: 'store-1' });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
    expect(args.orderBy).toEqual([{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }]);
    expect(resultado).toMatchObject({ total: 1, page: 1, pageSize: 50 });
    expect(resultado.items[0]).toMatchObject({
      id: 'promo-1',
      name: 'Promo de prueba',
      type: 'PERCENTAGE',
      config: { percent: 10 },
    });
  });

  it('aplica los filtros de estado, tipo y búsqueda', async () => {
    prismaMock.promotion.findMany.mockResolvedValue([]);
    prismaMock.promotion.count.mockResolvedValue(0);

    await listPromotions({
      storeId: 'store-1',
      isActive: false,
      type: 'COMBO',
      search: 'verano',
      page: 2,
      pageSize: 10,
    });

    const args = datosDe(prismaMock.promotion.findMany);
    expect(args.where).toEqual({
      storeId: 'store-1',
      isActive: false,
      type: 'COMBO',
      name: { contains: 'verano', mode: 'insensitive' },
    });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(prismaMock.promotion.count).toHaveBeenCalledWith({
      where: {
        storeId: 'store-1',
        isActive: false,
        type: 'COMBO',
        name: { contains: 'verano', mode: 'insensitive' },
      },
    });
  });

  it('corrige una paginación inválida', async () => {
    prismaMock.promotion.findMany.mockResolvedValue([]);
    prismaMock.promotion.count.mockResolvedValue(0);

    const resultado = await listPromotions({ storeId: 'store-1', page: 0, pageSize: -5 });

    expect(resultado).toMatchObject({ page: 1, pageSize: 50 });
    expect(datosDe(prismaMock.promotion.findMany).skip).toBe(0);
  });

  it('serializa los ítems sin producto ni categoría asociados', async () => {
    prismaMock.promotion.findMany.mockResolvedValue([
      promotionFull({
        items: [
          itemFull({
            productId: null,
            product: null,
            categoryId: 'category-1',
            category: { id: 'category-1', name: 'Abarrotes' },
            comboPrice: dec('25.00'),
          }),
          itemFull({ id: 'promoitem-2', productId: null, product: null, categoryId: null, comboPrice: null }),
        ],
      }),
    ]);
    prismaMock.promotion.count.mockResolvedValue(1);

    const resultado = await listPromotions({ storeId: 'store-1' });

    expect(resultado.items[0].items).toEqual([
      {
        id: 'promoitem-1',
        productId: null,
        productName: null,
        productSku: null,
        productPrice: null,
        categoryId: 'category-1',
        categoryName: 'Abarrotes',
        comboPrice: 25,
      },
      {
        id: 'promoitem-2',
        productId: null,
        productName: null,
        productSku: null,
        productPrice: null,
        categoryId: null,
        categoryName: null,
        comboPrice: null,
      },
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getPromotion
// ───────────────────────────────────────────────────────────────────────────

describe('getPromotion', () => {
  it('devuelve la promoción serializada de la tienda', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(promotionFull());

    const resultado = await getPromotion('promo-1', 'store-1');

    expect(prismaMock.promotion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'promo-1', storeId: 'store-1' } })
    );
    expect(resultado).toMatchObject({
      id: 'promo-1',
      type: 'PERCENTAGE',
      createdBy: { id: 'user-1', name: 'Gerente de Prueba' },
    });
    expect(resultado?.items[0]).toEqual({
      id: 'promoitem-1',
      productId: 'product-1',
      productName: 'Refresco 600ml',
      productSku: 'SKU-001',
      productPrice: 15,
      categoryId: null,
      categoryName: null,
      comboPrice: null,
    });
  });

  it('devuelve null cuando la promoción no existe en la tienda', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(null);

    expect(await getPromotion('promo-9', 'store-1')).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// createPromotion
// ───────────────────────────────────────────────────────────────────────────

describe('createPromotion', () => {
  it('crea la promoción, audita y emite el evento', async () => {
    prepararCreacion();

    const resultado = await createPromotion(entradaCreacion());

    const data = datosDe(prismaMock.promotion.create).data;
    expect(data).toMatchObject({
      storeId: 'store-1',
      name: 'Promo verano',
      description: null,
      type: 'PERCENTAGE',
      config: { percent: 10 },
      isActive: true,
      priority: 0,
      maxUses: null,
      usesCount: 0,
      createdById: 'user-1',
      items: { create: [{ productId: 'product-1', categoryId: null, comboPrice: null }] },
    });
    expect(prismaMock.product.count).toHaveBeenCalledWith({
      where: { id: { in: ['product-1'] }, storeId: 'store-1' },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'PROMOTION_CREATED',
        entity: 'PROMOTION',
        entityId: 'promo-1',
        metadata: { name: 'Promo de prueba', type: 'PERCENTAGE' },
      },
    });
    expect(emitToStore).toHaveBeenCalledWith('store-1', 'promotion:created', { id: 'promo-1' });
    expect(resultado).toMatchObject({ id: 'promo-1', name: 'Promo de prueba' });
  });

  it('cobra el precio de combo del ítem y la descripción recibida', async () => {
    prepararCreacion(2);
    prismaMock.promotion.create.mockResolvedValue(
      promotionFull({
        type: 'COMBO',
        config: { comboPrice: 40 },
        items: [
          itemFull({ comboPrice: dec('40.00') }),
          itemFull({ id: 'promoitem-2', productId: 'product-2' }),
        ],
      })
    );

    await createPromotion(
      entradaCreacion({
        type: 'COMBO',
        config: { comboPrice: 40 },
        description: 'Refresco + botana',
        items: [{ productId: 'product-1', comboPrice: 40 }, { productId: 'product-2' }],
      })
    );

    const data = datosDe(prismaMock.promotion.create).data;
    expect(data.description).toBe('Refresco + botana');
    expect(data.items.create).toEqual([
      { productId: 'product-1', categoryId: null, comboPrice: 40 },
      { productId: 'product-2', categoryId: null, comboPrice: null },
    ]);
  });

  it('no valida productos ni categorías cuando la promo no los usa', async () => {
    prepararCreacion();

    await createPromotion(
      entradaCreacion({
        type: 'TIERED_BY_AMOUNT',
        config: { tiers: [{ minAmount: 100, percent: 10 }] },
        items: [],
      })
    );

    expect(prismaMock.product.count).not.toHaveBeenCalled();
    expect(prismaMock.category.count).not.toHaveBeenCalled();
    expect(datosDe(prismaMock.promotion.create).data.items.create).toEqual([]);
  });

  it('acepta categorías de la misma tienda', async () => {
    prepararCreacion(0, 1);

    await createPromotion(
      entradaCreacion({
        type: 'CATEGORY_PERCENTAGE',
        config: { percent: 15 },
        items: [{ categoryId: 'category-1' }],
      })
    );

    expect(prismaMock.category.count).toHaveBeenCalledWith({
      where: { id: { in: ['category-1'] }, storeId: 'store-1' },
    });
    expect(datosDe(prismaMock.promotion.create).data.items.create).toEqual([
      { productId: null, categoryId: 'category-1', comboPrice: null },
    ]);
  });

  it('rechaza fechas invertidas', async () => {
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            startsAt: new Date('2026-02-01T00:00:00.000Z'),
            endsAt: new Date('2026-02-01T00:00:00.000Z'),
          })
        ),
      { status: 400, code: 'INVALID_PROMO_DATES' }
    );
    expect(prismaMock.promotion.create).not.toHaveBeenCalled();
  });

  it('rechaza productos de otra tienda', async () => {
    prismaMock.product.count.mockResolvedValue(0);

    await expectApiError(() => createPromotion(entradaCreacion()), {
      status: 400,
      code: 'INVALID_PRODUCT',
    });
    expect(prismaMock.promotion.create).not.toHaveBeenCalled();
  });

  it('rechaza categorías de otra tienda', async () => {
    prismaMock.category.count.mockResolvedValue(0);

    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: 'CATEGORY_PERCENTAGE',
            config: { percent: 15 },
            items: [{ categoryId: 'category-9' }],
          })
        ),
      { status: 400, code: 'INVALID_CATEGORY' }
    );
    expect(prismaMock.promotion.create).not.toHaveBeenCalled();
  });

  it('rechaza días de la semana inválidos', async () => {
    await expectApiError(
      () => createPromotion(entradaCreacion({ weekdays: ['LUNES'] })),
      { status: 400, code: 'INVALID_PROMO_WEEKDAYS', message: 'Día inválido: LUNES' }
    );
    expect(prismaMock.promotion.create).not.toHaveBeenCalled();
  });

  it('rechaza una configuración nula o que no es objeto', async () => {
    await expectApiError(
      () => createPromotion(entradaCreacion({ config: null as unknown as PromotionConfig })),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
    await expectApiError(
      () => createPromotion(entradaCreacion({ config: 'diez' as unknown as PromotionConfig })),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
  });

  it('valida la configuración de DIRECT_AMOUNT', async () => {
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({ type: 'DIRECT_AMOUNT', config: { amount: '5' } as unknown as PromotionConfig })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'Monto directo debe ser > 0' }
    );
    await expectApiError(
      () => createPromotion(entradaCreacion({ type: 'DIRECT_AMOUNT', config: { amount: 0 } })),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
    await expectApiError(
      () => createPromotion(entradaCreacion({ type: 'DIRECT_AMOUNT', config: { amount: -5 } })),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
  });

  it('valida la configuración de PERCENTAGE', async () => {
    await expectApiError(
      () => createPromotion(entradaCreacion({ config: { percent: 0 } })),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
    await expectApiError(
      () => createPromotion(entradaCreacion({ config: { percent: 101 } })),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({ config: { percent: '10' } as unknown as PromotionConfig })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
  });

  it('valida la configuración de N_FOR_DISCOUNT', async () => {
    const base = { buyQuantity: 2, discountPercent: 50, appliesTo: 'EVERY_NTH' };

    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: 'N_FOR_DISCOUNT',
            config: { ...base, buyQuantity: 1 } as unknown as PromotionConfig,
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'Cantidad de compra debe ser >= 2' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: 'N_FOR_DISCOUNT',
            config: { ...base, buyQuantity: '2' } as unknown as PromotionConfig,
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: 'N_FOR_DISCOUNT',
            config: { ...base, discountPercent: 0 } as unknown as PromotionConfig,
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'Porcentaje de descuento debe estar entre 0 y 100' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: 'N_FOR_DISCOUNT',
            config: { ...base, discountPercent: 101 } as unknown as PromotionConfig,
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: 'N_FOR_DISCOUNT',
            config: { ...base, appliesTo: 'OTRO' } as unknown as PromotionConfig,
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'appliesTo debe ser EVERY_NTH o ALL_AFTER_N' }
    );
  });

  it('valida la configuración de N_FOR_FREE', async () => {
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: 'N_FOR_FREE',
            config: { buyQuantity: 0, freeQuantity: 1 } as unknown as PromotionConfig,
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'Cantidad de compra debe ser >= 1' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: 'N_FOR_FREE',
            config: { buyQuantity: 2, freeQuantity: 0 } as unknown as PromotionConfig,
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'Cantidad gratis debe ser >= 1' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: 'N_FOR_FREE',
            config: { buyQuantity: 2, freeQuantity: '1' } as unknown as PromotionConfig,
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
  });

  it('valida la configuración de TIERED_BY_AMOUNT', async () => {
    const tipo = 'TIERED_BY_AMOUNT' as PromotionTypeStr;

    await expectApiError(
      () => createPromotion(entradaCreacion({ type: tipo, config: { tiers: [] }, items: [] })),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'Debe definir al menos un nivel' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: tipo,
            config: { tiers: 'niveles' } as unknown as PromotionConfig,
            items: [],
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: tipo,
            config: { tiers: [{ minAmount: -1, percent: 10 }] },
            items: [],
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'minAmount debe ser >= 0' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: tipo,
            config: { tiers: [{ minAmount: '100', percent: 10 }] } as unknown as PromotionConfig,
            items: [],
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: tipo,
            config: { tiers: [{ minAmount: 100, percent: 0 }] },
            items: [],
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'percent debe estar entre 0 y 100' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: tipo,
            config: { tiers: [{ minAmount: 100, percent: 101 }] },
            items: [],
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
  });

  it('valida la configuración de COMBO', async () => {
    const tipo = 'COMBO' as PromotionTypeStr;
    const items = [{ productId: 'product-1' }, { productId: 'product-2' }];

    await expectApiError(
      () => createPromotion(entradaCreacion({ type: tipo, config: {}, items })),
      {
        status: 400,
        code: 'INVALID_PROMO_CONFIG',
        message: 'Combo debe definir comboPrice o discountPercent',
      }
    );
    await expectApiError(
      () => createPromotion(entradaCreacion({ type: tipo, config: { comboPrice: 0 }, items })),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'comboPrice debe ser > 0' }
    );
    await expectApiError(
      () => createPromotion(entradaCreacion({ type: tipo, config: { discountPercent: 0 }, items })),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'discountPercent debe estar entre 0 y 100' }
    );
    await expectApiError(
      () =>
        createPromotion(entradaCreacion({ type: tipo, config: { discountPercent: 150 }, items })),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
  });

  it('valida la configuración de CATEGORY_PERCENTAGE', async () => {
    const tipo = 'CATEGORY_PERCENTAGE' as PromotionTypeStr;
    const items = [{ categoryId: 'category-1' }];

    await expectApiError(
      () => createPromotion(entradaCreacion({ type: tipo, config: { percent: 0 }, items })),
      { status: 400, code: 'INVALID_PROMO_CONFIG', message: 'Porcentaje debe estar entre 0 y 100' }
    );
    await expectApiError(
      () => createPromotion(entradaCreacion({ type: tipo, config: { percent: 101 }, items })),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: tipo,
            config: {} as unknown as PromotionConfig,
            items,
          })
        ),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
  });

  it('exige al menos una categoría para CATEGORY_PERCENTAGE', async () => {
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: 'CATEGORY_PERCENTAGE',
            config: { percent: 10 },
            items: [{ productId: 'product-1' }],
          })
        ),
      {
        status: 400,
        code: 'INVALID_PROMO_ITEMS',
        message: 'Debe seleccionar al menos una categoría',
      }
    );
  });

  it('exige al menos un producto para las promociones de producto', async () => {
    await expectApiError(
      () => createPromotion(entradaCreacion({ items: [{ categoryId: 'category-1' }] })),
      {
        status: 400,
        code: 'INVALID_PROMO_ITEMS',
        message: 'Debe seleccionar al menos un producto',
      }
    );
  });

  it('exige dos productos para un COMBO', async () => {
    await expectApiError(
      () =>
        createPromotion(
          entradaCreacion({
            type: 'COMBO',
            config: { comboPrice: 40 },
            items: [{ productId: 'product-1' }],
          })
        ),
      {
        status: 400,
        code: 'INVALID_PROMO_ITEMS',
        message: 'Combo debe incluir al menos 2 productos',
      }
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// updatePromotion
// ───────────────────────────────────────────────────────────────────────────

describe('updatePromotion', () => {
  it('actualiza con todos los campos y reemplaza los ítems', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(promotionFull());
    prismaMock.promotionItem.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.promotion.update.mockResolvedValue(promotionFull({ name: 'Promo renovada' }));

    const entrada: UpdatePromotionInput = {
      userId: 'user-1',
      name: '  Promo renovada  ',
      description: 'Nueva descripción',
      type: 'DIRECT_AMOUNT',
      config: { amount: 5 },
      startsAt: new Date('2026-02-01T00:00:00.000Z'),
      endsAt: new Date('2026-03-01T00:00:00.000Z'),
      weekdays: ['MONDAY', 'TUESDAY'],
      timeFrom: '09:00',
      timeTo: '18:00',
      isActive: false,
      priority: 7,
      maxUses: 20,
      items: [{ productId: 'product-1' }, { productId: 'product-2', comboPrice: 30 }],
    };

    const resultado = await updatePromotion('promo-1', 'store-1', entrada);

    expect(prismaMock.promotionItem.deleteMany).toHaveBeenCalledWith({
      where: { promotionId: 'promo-1' },
    });
    const data = datosDe(prismaMock.promotion.update).data;
    expect(data).toEqual({
      name: 'Promo renovada',
      description: 'Nueva descripción',
      type: 'DIRECT_AMOUNT',
      config: { amount: 5 },
      startsAt: new Date('2026-02-01T00:00:00.000Z'),
      endsAt: new Date('2026-03-01T00:00:00.000Z'),
      weekdays: ['MONDAY', 'TUESDAY'],
      timeFrom: '09:00',
      timeTo: '18:00',
      isActive: false,
      priority: 7,
      maxUses: 20,
      items: {
        create: [
          { productId: 'product-1', categoryId: null, comboPrice: null },
          { productId: 'product-2', categoryId: null, comboPrice: 30 },
        ],
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'PROMOTION_UPDATED',
        entity: 'PROMOTION',
        entityId: 'promo-1',
        metadata: { name: 'Promo renovada' },
      },
    });
    expect(emitToStore).toHaveBeenCalledWith('store-1', 'promotion:updated', { id: 'promo-1' });
    expect(resultado.name).toBe('Promo renovada');
  });

  it('actualiza solo el nombre sin tocar los ítems', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(promotionFull());
    prismaMock.promotion.update.mockResolvedValue(promotionFull({ name: 'Solo nombre' }));

    await updatePromotion('promo-1', 'store-1', { userId: 'user-1', name: ' Solo nombre ' });

    expect(prismaMock.promotionItem.deleteMany).not.toHaveBeenCalled();
    expect(datosDe(prismaMock.promotion.update).data).toEqual({ name: 'Solo nombre' });
  });

  it('limpia la descripción y los límites horarios cuando se envían en null', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(promotionFull({ timeFrom: '09:00', timeTo: '18:00' }));
    prismaMock.promotion.update.mockResolvedValue(promotionFull());

    await updatePromotion('promo-1', 'store-1', {
      userId: 'user-1',
      description: null,
      timeFrom: null,
      timeTo: null,
      maxUses: null,
    });

    const data = datosDe(prismaMock.promotion.update).data;
    expect(data).toEqual({ description: null, timeFrom: null, timeTo: null, maxUses: null });
  });

  it('lanza PROMOTION_NOT_FOUND si la promoción no existe', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(null);

    await expectApiError(
      () => updatePromotion('promo-9', 'store-1', { userId: 'user-1', name: 'X' }),
      { status: 404, code: 'PROMOTION_NOT_FOUND', message: 'Promoción no encontrada' }
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('valida la configuración cuando cambia el tipo o el config', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(promotionFull());

    await expectApiError(
      () => updatePromotion('promo-1', 'store-1', { userId: 'user-1', config: { percent: 0 } }),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
    await expectApiError(
      () =>
        updatePromotion('promo-1', 'store-1', {
          userId: 'user-1',
          type: 'DIRECT_AMOUNT',
          config: { amount: 0 },
        }),
      { status: 400, code: 'INVALID_PROMO_CONFIG' }
    );
    expect(prismaMock.promotion.update).not.toHaveBeenCalled();
  });

  it('valida los ítems y los días recibidos', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(promotionFull());

    await expectApiError(
      () => updatePromotion('promo-1', 'store-1', { userId: 'user-1', items: [] }),
      { status: 400, code: 'INVALID_PROMO_ITEMS' }
    );
    await expectApiError(
      () => updatePromotion('promo-1', 'store-1', { userId: 'user-1', weekdays: ['FIESTA'] }),
      { status: 400, code: 'INVALID_PROMO_WEEKDAYS' }
    );
    expect(prismaMock.promotion.update).not.toHaveBeenCalled();
  });

  it('rechaza fechas invertidas al actualizar', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(promotionFull());

    await expectApiError(
      () =>
        updatePromotion('promo-1', 'store-1', {
          userId: 'user-1',
          startsAt: new Date('2027-05-01T00:00:00.000Z'),
        }),
      { status: 400, code: 'INVALID_PROMO_DATES' }
    );
    expect(prismaMock.promotion.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// togglePromotion
// ───────────────────────────────────────────────────────────────────────────

describe('togglePromotion', () => {
  it('activa la promoción y audita la acción', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(promotionFull({ isActive: false }));
    prismaMock.promotion.update.mockResolvedValue(promotionFull({ isActive: true }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await togglePromotion('promo-1', 'store-1', 'user-1', true);

    expect(prismaMock.promotion.update).toHaveBeenCalledWith({
      where: { id: 'promo-1' },
      data: { isActive: true },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'PROMOTION_ACTIVATED', entityId: 'promo-1' }),
    });
    expect(emitToStore).toHaveBeenCalledWith('store-1', 'promotion:updated', { id: 'promo-1' });
    expect(resultado).toEqual({ id: 'promo-1', isActive: true });
  });

  it('desactiva la promoción y audita la acción', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(promotionFull());
    prismaMock.promotion.update.mockResolvedValue(promotionFull({ isActive: false }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await togglePromotion('promo-1', 'store-1', 'user-1', false);

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'PROMOTION_DEACTIVATED' }),
    });
    expect(resultado).toEqual({ id: 'promo-1', isActive: false });
  });

  it('lanza PROMOTION_NOT_FOUND si no existe en la tienda', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(null);

    await expectApiError(() => togglePromotion('promo-9', 'store-1', 'user-1', true), {
      status: 404,
      code: 'PROMOTION_NOT_FOUND',
    });
    expect(prismaMock.promotion.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// deletePromotion
// ───────────────────────────────────────────────────────────────────────────

describe('deletePromotion', () => {
  it('desactiva la promoción y le fija el fin en la fecha actual', async () => {
    fijarAhora();
    prismaMock.promotion.findFirst.mockResolvedValue(promotionFull());
    prismaMock.promotion.update.mockResolvedValue(promotionFull({ isActive: false }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await deletePromotion('promo-1', 'store-1', 'user-1');

    expect(prismaMock.promotion.update).toHaveBeenCalledWith({
      where: { id: 'promo-1' },
      data: { isActive: false, endsAt: AHORA },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'PROMOTION_DELETED' }),
    });
    expect(emitToStore).toHaveBeenCalledWith('store-1', 'promotion:deleted', { id: 'promo-1' });
    expect(resultado).toEqual({ id: 'promo-1' });
    expect(prismaMock.promotion.delete).not.toHaveBeenCalled();
  });

  it('lanza PROMOTION_NOT_FOUND si no existe en la tienda', async () => {
    prismaMock.promotion.findFirst.mockResolvedValue(null);

    await expectApiError(() => deletePromotion('promo-9', 'store-1', 'user-1'), {
      status: 404,
      code: 'PROMOTION_NOT_FOUND',
    });
    expect(prismaMock.promotion.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getApplicablePromotionsForPos
// ───────────────────────────────────────────────────────────────────────────

describe('getApplicablePromotionsForPos', () => {
  it('devuelve en formato lite las promociones vigentes con usos disponibles', async () => {
    fijarAhora();
    prismaMock.promotion.findMany.mockResolvedValue([
      promotionLite({ id: 'promo-1', maxUses: null }),
      promotionLite({ id: 'promo-2', maxUses: 5, usesCount: 2 }),
      promotionLite({ id: 'promo-3', maxUses: 5, usesCount: 5 }),
    ]);

    const resultado = await getApplicablePromotionsForPos('store-1');

    const args = datosDe(prismaMock.promotion.findMany);
    expect(args.where).toMatchObject({ storeId: 'store-1', isActive: true });
    expect(args.where.startsAt).toEqual({ lte: AHORA });
    expect(args.where.endsAt).toEqual({ gte: AHORA });
    expect(args.include).toEqual({ items: true });

    expect(resultado.map((p) => p.id)).toEqual(['promo-1', 'promo-2']);
    expect(resultado[0]).toMatchObject({
      type: 'PERCENTAGE',
      config: { percent: 10 },
      weekdays: [],
      items: [{ productId: 'product-1', categoryId: null, comboPrice: null }],
    });
  });

  it('devuelve una lista vacía cuando no hay promociones', async () => {
    prismaMock.promotion.findMany.mockResolvedValue([]);

    expect(await getApplicablePromotionsForPos('store-1')).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// previewPromotions
// ───────────────────────────────────────────────────────────────────────────

describe('previewPromotions', () => {
  it('calcula el descuento de la vista previa con las promociones vigentes', async () => {
    fijarAhora();
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        name: 'Refresco 600ml',
        sellingPrice: dec('20.00'),
        costPrice: dec('10.00'),
        categoryId: 'category-1',
      },
    ]);
    prismaMock.promotion.findMany.mockResolvedValue([
      promotionLite({ config: { percent: 10 }, items: [{ productId: 'product-1' }] }),
    ]);

    const resultado = await previewPromotions({
      storeId: 'store-1',
      items: [{ productId: 'product-1', quantity: 2 }],
    });

    expect(prismaMock.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['product-1'] }, storeId: 'store-1', isActive: true },
    });
    expect(resultado.lines[0]).toMatchObject({ unitPrice: 18, subtotal: 36, originalUnitPrice: 20 });
    expect(resultado.total).toBe(36);
    expect(resultado.applied[0]).toMatchObject({ promotionId: 'promo-1', savedAmount: 4 });
  });

  it('respeta el precio unitario enviado por el cliente', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        name: 'Refresco 600ml',
        sellingPrice: dec('20.00'),
        costPrice: dec('10.00'),
        categoryId: null,
      },
    ]);
    prismaMock.promotion.findMany.mockResolvedValue([]);

    const resultado = await previewPromotions({
      storeId: 'store-1',
      items: [{ productId: 'product-1', quantity: 1, unitPrice: 100 }],
    });

    expect(resultado.lines[0].unitPrice).toBe(100);
    expect(resultado.total).toBe(100);
  });

  it('lanza PRODUCT_NOT_FOUND si algún producto no existe o está inactivo', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);

    await expectApiError(
      () =>
        previewPromotions({
          storeId: 'store-1',
          items: [{ productId: 'product-9', quantity: 1 }],
        }),
      {
        status: 400,
        code: 'PRODUCT_NOT_FOUND',
        message: 'Uno o más productos no existen en esta tienda',
      }
    );
    expect(prismaMock.promotion.findMany).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// resolvePromotionsForSale
// ───────────────────────────────────────────────────────────────────────────

describe('resolvePromotionsForSale', () => {
  it('resuelve las promociones aplicables dentro de la transacción', async () => {
    fijarAhora();
    prismaMock.promotion.findMany.mockResolvedValue([
      promotionLite({ id: 'promo-1', config: { percent: 10 } }),
      promotionLite({ id: 'promo-agotada', maxUses: 1, usesCount: 1 }),
    ]);

    const lineas: CartLineInput[] = [{ productId: 'product-1', unitPrice: 100, quantity: 1 }];
    const resultado = await resolvePromotionsForSale(prismaMock as never, 'store-1', lineas);

    const args = datosDe(prismaMock.promotion.findMany);
    expect(args.where).toMatchObject({ storeId: 'store-1', isActive: true });
    expect(args.where.startsAt).toEqual({ lte: AHORA });
    expect(args.where.endsAt).toEqual({ gte: AHORA });
    expect(resultado.total).toBe(90);
    expect(resultado.applied.map((a) => a.promotionId)).toEqual(['promo-1']);
  });

  it('no aplica nada cuando no hay promociones', async () => {
    prismaMock.promotion.findMany.mockResolvedValue([]);

    const resultado = await resolvePromotionsForSale(prismaMock as never, 'store-1', [
      { productId: 'product-1', unitPrice: 50, quantity: 2 },
    ]);

    expect(resultado).toMatchObject({ total: 100, applied: [], tierDiscount: 0 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// applyPromotionResolutionToSaleTx
// ───────────────────────────────────────────────────────────────────────────

describe('applyPromotionResolutionToSaleTx', () => {
  function aplicacion(overrides: Partial<AppliedPromotion> = {}): AppliedPromotion {
    return {
      promotionId: 'promo-1',
      promotionName: 'Promo de prueba',
      type: 'PERCENTAGE',
      productId: 'product-1',
      originalAmount: 100,
      discountedAmount: 90,
      savedAmount: 10,
      details: { regla: 'demo' },
      ...overrides,
    };
  }

  function resolucion(applied: AppliedPromotion[]): PromotionResolution {
    return {
      lines: [],
      applied,
      subtotal: 100,
      subtotalAfterLinePromos: 90,
      tierDiscount: 0,
      total: 90,
    };
  }

  it('incrementa los usos y registra cada aplicación', async () => {
    prismaMock.promotion.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.promotionApplication.create.mockResolvedValue({ id: 'app-1' });

    await applyPromotionResolutionToSaleTx(
      prismaMock as never,
      'sale-1',
      'store-1',
      resolucion([aplicacion(), aplicacion({ promotionId: 'promo-2', productId: null })])
    );

    expect(prismaMock.promotion.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.promotion.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'promo-1',
        storeId: 'store-1',
        OR: [{ maxUses: null }, { usesCount: { lt: 0 } }],
      },
      data: { usesCount: { increment: 1 } },
    });
    expect(prismaMock.promotionApplication.create).toHaveBeenNthCalledWith(1, {
      data: {
        storeId: 'store-1',
        promotionId: 'promo-1',
        saleId: 'sale-1',
        productId: 'product-1',
        originalAmount: 100,
        discountedAmount: 90,
        savedAmount: 10,
        details: { regla: 'demo' },
      },
    });
    expect(prismaMock.promotionApplication.create).toHaveBeenCalledTimes(2);
  });

  it('aborta con PROMOTION_MAX_USES cuando la promoción agotó sus usos', async () => {
    prismaMock.promotion.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.promotion.findUnique.mockResolvedValue({
      id: 'promo-1',
      name: 'Promo agotada',
      maxUses: 5,
      usesCount: 5,
    });

    await expectApiError(
      () =>
        applyPromotionResolutionToSaleTx(
          prismaMock as never,
          'sale-1',
          'store-1',
          resolucion([aplicacion()])
        ),
      {
        status: 400,
        code: 'PROMOTION_MAX_USES',
        message: 'La promoción "Promo agotada" alcanzó su máximo de usos',
      }
    );
    expect(prismaMock.promotionApplication.create).not.toHaveBeenCalled();
  });

  it('reintenta el incremento cuando la promoción no tiene límite de usos', async () => {
    prismaMock.promotion.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.promotion.findUnique.mockResolvedValue({
      id: 'promo-1',
      name: 'Promo libre',
      maxUses: null,
      usesCount: 3,
    });
    prismaMock.promotion.update.mockResolvedValue({ id: 'promo-1' });
    prismaMock.promotionApplication.create.mockResolvedValue({ id: 'app-1' });

    await applyPromotionResolutionToSaleTx(
      prismaMock as never,
      'sale-1',
      'store-1',
      resolucion([aplicacion()])
    );

    expect(prismaMock.promotion.update).toHaveBeenCalledWith({
      where: { id: 'promo-1' },
      data: { usesCount: { increment: 1 } },
    });
    expect(prismaMock.promotionApplication.create).toHaveBeenCalledTimes(1);
  });

  it('no hace nada cuando la resolución no tiene aplicaciones', async () => {
    await applyPromotionResolutionToSaleTx(
      prismaMock as never,
      'sale-1',
      'store-1',
      resolucion([])
    );

    expect(prismaMock.promotion.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.promotionApplication.create).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// revertPromotionApplicationsForSale
// ───────────────────────────────────────────────────────────────────────────

describe('revertPromotionApplicationsForSale', () => {
  it('decrementa los usos y borra las aplicaciones de la venta', async () => {
    prismaMock.promotionApplication.findMany.mockResolvedValue([
      { id: 'app-1', promotionId: 'promo-1' },
      { id: 'app-2', promotionId: 'promo-2' },
    ]);
    prismaMock.promotion.update.mockResolvedValue({ id: 'promo-1' });

    await revertPromotionApplicationsForSale(prismaMock as never, 'sale-1');

    expect(prismaMock.promotionApplication.findMany).toHaveBeenCalledWith({
      where: { saleId: 'sale-1' },
    });
    expect(prismaMock.promotion.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'promo-1' },
      data: { usesCount: { decrement: 1 } },
    });
    expect(prismaMock.promotion.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'promo-2' },
      data: { usesCount: { decrement: 1 } },
    });
    expect(prismaMock.promotionApplication.deleteMany).toHaveBeenCalledWith({
      where: { saleId: 'sale-1' },
    });
  });

  it('solo borra cuando la venta no tiene aplicaciones', async () => {
    prismaMock.promotionApplication.findMany.mockResolvedValue([]);

    await revertPromotionApplicationsForSale(prismaMock as never, 'sale-1');

    expect(prismaMock.promotion.update).not.toHaveBeenCalled();
    expect(prismaMock.promotionApplication.deleteMany).toHaveBeenCalledWith({
      where: { saleId: 'sale-1' },
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getPromotionReport
// ───────────────────────────────────────────────────────────────────────────

describe('getPromotionReport', () => {
  function aplicacionReporte(overrides: Record<string, unknown> = {}) {
    return {
      id: 'app-1',
      storeId: 'store-1',
      promotionId: 'promo-1',
      saleId: 'sale-1',
      productId: 'product-1',
      originalAmount: dec('100.00'),
      discountedAmount: dec('90.00'),
      savedAmount: dec('10.00'),
      details: {},
      createdAt: AHORA,
      promotion: {
        id: 'promo-1',
        name: 'Promo de prueba',
        type: 'PERCENTAGE',
        startsAt: INICIO,
        endsAt: FIN,
        isActive: true,
      },
      product: {
        id: 'product-1',
        name: 'Refresco 600ml',
        sku: 'SKU-001',
        costPrice: dec('10.00'),
        sellingPrice: dec('15.00'),
      },
      sale: {
        id: 'sale-1',
        saleNumber: 'STORE001-0001',
        createdAt: AHORA,
        status: 'COMPLETED',
      },
      ...overrides,
    };
  }

  function promoReporte(overrides: Record<string, unknown> = {}) {
    return {
      id: 'promo-1',
      storeId: 'store-1',
      name: 'Promo de prueba',
      type: 'PERCENTAGE',
      startsAt: INICIO,
      endsAt: FIN,
      isActive: true,
      priority: 2,
      maxUses: 10,
      usesCount: 3,
      createdAt: AHORA,
      items: [
        {
          productId: 'product-1',
          product: {
            name: 'Refresco 600ml',
            sku: 'SKU-001',
            costPrice: dec('10.00'),
            sellingPrice: dec('15.00'),
          },
          categoryId: 'category-1',
          category: { name: 'Abarrotes' },
          comboPrice: dec('25.00'),
        },
        {
          productId: null,
          product: null,
          categoryId: null,
          category: null,
          comboPrice: null,
        },
      ],
      ...overrides,
    };
  }

  it('agrega aplicaciones, totales y estado de cada promoción', async () => {
    fijarAhora();
    prismaMock.promotionApplication.findMany.mockResolvedValue([
      aplicacionReporte(),
      aplicacionReporte({
        id: 'app-2',
        saleId: 'sale-2',
        productId: null,
        product: null,
        sale: { id: 'sale-2', saleNumber: 'STORE001-0002', createdAt: AHORA, status: 'COMPLETED' },
      }),
      aplicacionReporte({
        id: 'app-3',
        saleId: 'sale-3',
        sale: { id: 'sale-3', saleNumber: 'STORE001-0003', createdAt: AHORA, status: 'CANCELED' },
      }),
    ]);
    prismaMock.promotion.findMany.mockResolvedValue([
      promoReporte({ id: 'promo-activa' }),
      promoReporte({ id: 'promo-inactiva', isActive: false }),
      promoReporte({ id: 'promo-caducada', endsAt: new Date('2026-01-10T00:00:00.000Z') }),
      promoReporte({
        id: 'promo-pendiente',
        startsAt: new Date('2026-02-01T00:00:00.000Z'),
        endsAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
    ]);
    prismaMock.promotionApplication.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: {
        originalAmount: dec('300.00'),
        discountedAmount: dec('250.00'),
        savedAmount: dec('50.00'),
      },
    });

    const resultado = await getPromotionReport({ storeId: 'store-1' });

    expect(resultado.summary).toEqual({
      totalApplications: 3,
      totalSalesWithPromo: 2,
      totalOriginalAmount: 300,
      totalDiscountedAmount: 250,
      totalSaved: 50,
    });
    expect(resultado.applications).toHaveLength(2);
    expect(resultado.applications[0]).toEqual({
      id: 'app-1',
      promotionId: 'promo-1',
      promotionName: 'Promo de prueba',
      promotionType: 'PERCENTAGE',
      saleId: 'sale-1',
      saleNumber: 'STORE001-0001',
      saleDate: AHORA,
      productId: 'product-1',
      productName: 'Refresco 600ml',
      productSku: 'SKU-001',
      productCost: 10,
      productPrice: 15,
      originalAmount: 100,
      discountedAmount: 90,
      savedAmount: 10,
      createdAt: AHORA,
    });
    expect(resultado.applications[1]).toMatchObject({
      id: 'app-2',
      productId: null,
      productName: null,
      productSku: null,
      productCost: null,
      productPrice: null,
    });
    expect(resultado.promotions.map((p) => p.status)).toEqual([
      'ACTIVE',
      'INACTIVE',
      'EXPIRED',
      'PENDING',
    ]);
    expect(resultado.promotions[0]).toMatchObject({
      id: 'promo-activa',
      priority: 2,
      maxUses: 10,
      usesCount: 3,
      createdAt: AHORA,
    });
    expect(resultado.promotions[0].items).toEqual([
      {
        productId: 'product-1',
        productName: 'Refresco 600ml',
        productSku: 'SKU-001',
        productCost: 10,
        productPrice: 15,
        categoryId: 'category-1',
        categoryName: 'Abarrotes',
        comboPrice: 25,
      },
      {
        productId: null,
        productName: null,
        productSku: null,
        productCost: null,
        productPrice: null,
        categoryId: null,
        categoryName: null,
        comboPrice: null,
      },
    ]);
  });

  it('aplica los filtros de promoción, tipo y rango de fechas', async () => {
    prismaMock.promotionApplication.findMany.mockResolvedValue([]);
    prismaMock.promotion.findMany.mockResolvedValue([]);
    prismaMock.promotionApplication.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { originalAmount: null, discountedAmount: null, savedAmount: null },
    });

    const resultado = await getPromotionReport({
      storeId: 'store-1',
      promotionId: 'promo-1',
      type: 'COMBO',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    const where = datosDe(prismaMock.promotionApplication.findMany).where;
    expect(where).toEqual({
      storeId: 'store-1',
      promotionId: 'promo-1',
      promotion: { type: 'COMBO' },
      createdAt: {
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-01-31T23:59:59.999Z'),
      },
    });
    expect(prismaMock.promotionApplication.aggregate).toHaveBeenCalledWith({
      where,
      _count: { _all: true },
      _sum: { originalAmount: true, discountedAmount: true, savedAmount: true },
    });
    expect(resultado.summary).toEqual({
      totalApplications: 0,
      totalSalesWithPromo: 0,
      totalOriginalAmount: 0,
      totalDiscountedAmount: 0,
      totalSaved: 0,
    });
    expect(resultado.applications).toEqual([]);
    expect(resultado.promotions).toEqual([]);
  });

  it('filtra solo por fecha de inicio', async () => {
    prismaMock.promotionApplication.findMany.mockResolvedValue([]);
    prismaMock.promotion.findMany.mockResolvedValue([]);
    prismaMock.promotionApplication.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { originalAmount: null, discountedAmount: null, savedAmount: null },
    });

    await getPromotionReport({ storeId: 'store-1', startDate: '2026-01-05' });

    expect(datosDe(prismaMock.promotionApplication.findMany).where.createdAt).toEqual({
      gte: new Date('2026-01-05T00:00:00.000Z'),
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Re-export de calculatePromotions
// ───────────────────────────────────────────────────────────────────────────

describe('calculatePromotions (reexportado)', () => {
  it('es la misma función del motor de cálculo', () => {
    expect(calculatePromotions).toBe(calculator.calculatePromotions);
  });

  it('calcula una resolución completa desde el servicio', () => {
    const resultado = calculatePromotions(
      [{ productId: 'product-1', unitPrice: 100, quantity: 1 }],
      [
        {
          id: 'promo-1',
          name: 'Promo de prueba',
          type: 'PERCENTAGE',
          config: { percent: 10 },
          startsAt: INICIO,
          endsAt: FIN,
          weekdays: [],
          timeFrom: null,
          timeTo: null,
          isActive: true,
          priority: 0,
          maxUses: null,
          usesCount: 0,
          items: [{ productId: 'product-1' }],
        },
      ],
      AHORA
    );

    expect(resultado.total).toBe(90);
  });
});
