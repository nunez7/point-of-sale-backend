import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import {
  calculatePromotions,
  getApplicablePromotions,
  isPromotionActive,
  toLite,
} from '../../src/services/promotionCalculator';
import type {
  CartLineInput,
  PromotionConfig,
  PromotionLite,
  PromotionTypeStr,
} from '../../src/services/promotionCalculator';

// ───────────────────────────────────────────────────────────────────────────
// Utilidades locales
// ───────────────────────────────────────────────────────────────────────────

const INICIO = new Date('2026-01-01T00:00:00.000Z');
const FIN = new Date('2026-12-31T23:59:59.000Z');
const AHORA = new Date('2026-01-15T18:00:00.000Z');

/** Jueves 15 de enero de 2026, 14:30 hora local (independiente del TZ). */
const JUEVES_1430 = new Date(2026, 0, 15, 14, 30, 0, 0);

afterEach(() => {
  vi.useRealTimers();
});

function promo(overrides: Partial<PromotionLite> = {}): PromotionLite {
  return {
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
    ...overrides,
  };
}

function linea(overrides: Partial<CartLineInput> = {}): CartLineInput {
  return {
    productId: 'product-1',
    unitPrice: 100,
    quantity: 1,
    ...overrides,
  };
}

/** Fila de Promotion tal como la devuelve Prisma con `include: { items: true }`. */
function filaPromo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'promo-1',
    storeId: 'store-1',
    name: 'Promo de prueba',
    description: null,
    type: 'PERCENTAGE' as PromotionTypeStr,
    config: { percent: 10 } as PromotionConfig,
    startsAt: INICIO,
    endsAt: FIN,
    weekdays: ['MONDAY', 'FRIDAY'],
    timeFrom: '09:00',
    timeTo: '18:00',
    isActive: true,
    priority: 3,
    maxUses: 10,
    usesCount: 2,
    createdById: 'user-1',
    createdAt: AHORA,
    updatedAt: AHORA,
    items: [
      {
        id: 'promoitem-1',
        promotionId: 'promo-1',
        productId: 'product-1',
        categoryId: null,
        comboPrice: new Prisma.Decimal('25.00'),
      },
      {
        id: 'promoitem-2',
        promotionId: 'promo-1',
        productId: null,
        categoryId: 'category-1',
        comboPrice: null,
      },
    ],
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// isPromotionActive
// ───────────────────────────────────────────────────────────────────────────

describe('isPromotionActive', () => {
  const PRODUCTOS = new Set(['product-1']);
  const CATEGORIAS = new Set(['category-1']);

  it('acepta una promoción activa y vigente', () => {
    expect(isPromotionActive(promo(), AHORA, PRODUCTOS, CATEGORIAS)).toBe(true);
  });

  it('rechaza una promoción desactivada', () => {
    expect(isPromotionActive(promo({ isActive: false }), AHORA, PRODUCTOS, CATEGORIAS)).toBe(false);
  });

  it('rechaza una promoción que aún no inicia', () => {
    const futura = promo({ startsAt: new Date('2026-02-01T00:00:00.000Z') });
    expect(isPromotionActive(futura, AHORA, PRODUCTOS, CATEGORIAS)).toBe(false);
  });

  it('rechaza una promoción caducada', () => {
    const caducada = promo({ endsAt: new Date('2026-01-10T00:00:00.000Z') });
    expect(isPromotionActive(caducada, AHORA, PRODUCTOS, CATEGORIAS)).toBe(false);
  });

  it('acepta la promoción justo en sus fechas límite', () => {
    const alLimite = promo({ startsAt: AHORA, endsAt: AHORA });
    expect(isPromotionActive(alLimite, AHORA, PRODUCTOS, CATEGORIAS)).toBe(true);
  });

  it('rechaza una promoción que agotó sus usos', () => {
    const agotada = promo({ maxUses: 5, usesCount: 5 });
    expect(isPromotionActive(agotada, AHORA, PRODUCTOS, CATEGORIAS)).toBe(false);
  });

  it('acepta una promoción con usos disponibles', () => {
    const disponible = promo({ maxUses: 5, usesCount: 4 });
    expect(isPromotionActive(disponible, AHORA, PRODUCTOS, CATEGORIAS)).toBe(true);
  });

  it('no evalúa días ni horas cuando no hay restricción', () => {
    expect(
      isPromotionActive(promo({ weekdays: [], timeFrom: null, timeTo: null }), AHORA, PRODUCTOS, CATEGORIAS)
    ).toBe(true);
  });

  it('acepta la promoción el día de la semana configurado', () => {
    const conDia = promo({ weekdays: ['THURSDAY'] });
    expect(isPromotionActive(conDia, JUEVES_1430, PRODUCTOS, CATEGORIAS)).toBe(true);
  });

  it('rechaza la promoción en otro día de la semana', () => {
    const conDia = promo({ weekdays: ['MONDAY', 'SUNDAY'] });
    expect(isPromotionActive(conDia, JUEVES_1430, PRODUCTOS, CATEGORIAS)).toBe(false);
  });

  it('acepta dentro del horario permitido', () => {
    const conHorario = promo({ timeFrom: '09:00', timeTo: '18:00' });
    expect(isPromotionActive(conHorario, JUEVES_1430, PRODUCTOS, CATEGORIAS)).toBe(true);
  });

  it('rechaza antes de la hora de inicio', () => {
    const conHorario = promo({ timeFrom: '09:00', timeTo: '18:00' });
    const temprano = new Date(2026, 0, 15, 8, 0, 0, 0);
    expect(isPromotionActive(conHorario, temprano, PRODUCTOS, CATEGORIAS)).toBe(false);
  });

  it('rechaza después de la hora de fin', () => {
    const conHorario = promo({ timeFrom: '09:00', timeTo: '18:00' });
    const tarde = new Date(2026, 0, 15, 20, 0, 0, 0);
    expect(isPromotionActive(conHorario, tarde, PRODUCTOS, CATEGORIAS)).toBe(false);
  });

  it('solo con hora de fin rechaza después de esa hora', () => {
    const soloFin = promo({ timeFrom: null, timeTo: '13:00' });
    expect(isPromotionActive(soloFin, JUEVES_1430, PRODUCTOS, CATEGORIAS)).toBe(false);
    expect(isPromotionActive(soloFin, new Date(2026, 0, 15, 12, 0, 0, 0), PRODUCTOS, CATEGORIAS)).toBe(
      true
    );
  });

  it('ignora las horas mal formadas', () => {
    const malFormada = promo({ timeFrom: '9', timeTo: 'abc' });
    expect(isPromotionActive(malFormada, JUEVES_1430, PRODUCTOS, CATEGORIAS)).toBe(true);

    const horaFueraDeRango = promo({ timeFrom: '25:00', timeTo: null });
    expect(isPromotionActive(horaFueraDeRango, JUEVES_1430, PRODUCTOS, CATEGORIAS)).toBe(true);

    const minutosFueraDeRango = promo({ timeFrom: '09:60', timeTo: null });
    expect(isPromotionActive(minutosFueraDeRango, JUEVES_1430, PRODUCTOS, CATEGORIAS)).toBe(true);

    const vacia = promo({ timeFrom: '', timeTo: null });
    expect(isPromotionActive(vacia, JUEVES_1430, PRODUCTOS, CATEGORIAS)).toBe(true);
  });

  it('exige una categoría del carrito para CATEGORY_PERCENTAGE', () => {
    const porCategoria = promo({
      type: 'CATEGORY_PERCENTAGE',
      config: { percent: 10 },
      items: [{ categoryId: 'category-1' }],
    });

    expect(isPromotionActive(porCategoria, AHORA, PRODUCTOS, CATEGORIAS)).toBe(true);
    expect(isPromotionActive(porCategoria, AHORA, PRODUCTOS, new Set(['category-9']))).toBe(false);
    expect(isPromotionActive(porCategoria, AHORA, PRODUCTOS, new Set())).toBe(false);
  });

  it('exige un producto del carrito para las promociones por producto', () => {
    const porProducto = promo({ items: [{ productId: 'product-9' }] });
    expect(isPromotionActive(porProducto, AHORA, PRODUCTOS, CATEGORIAS)).toBe(false);
    expect(isPromotionActive(porProducto, AHORA, new Set(['product-9']), CATEGORIAS)).toBe(true);
  });

  it('acepta promociones sin productos objetivo', () => {
    const sinItems = promo({ items: [] });
    expect(isPromotionActive(sinItems, AHORA, new Set(), CATEGORIAS)).toBe(true);

    const itemsSinProducto = promo({ items: [{ productId: null, categoryId: 'category-1' }] });
    expect(isPromotionActive(itemsSinProducto, AHORA, new Set(), CATEGORIAS)).toBe(true);
  });

  it('no revisa productos para TIERED_BY_AMOUNT', () => {
    const porEscalones = promo({
      type: 'TIERED_BY_AMOUNT',
      config: { tiers: [{ minAmount: 100, percent: 10 }] },
      items: [],
    });
    expect(isPromotionActive(porEscalones, AHORA, new Set(), new Set())).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getApplicablePromotions
// ───────────────────────────────────────────────────────────────────────────

describe('getApplicablePromotions', () => {
  it('filtra las promociones no vigentes con la fecha indicada', () => {
    const vigente = promo({ id: 'promo-vigente' });
    const caducada = promo({ id: 'promo-caducada', endsAt: new Date('2026-01-05T00:00:00.000Z') });
    const futura = promo({ id: 'promo-futura', startsAt: new Date('2026-03-01T00:00:00.000Z') });

    const resultado = getApplicablePromotions([vigente, caducada, futura], [linea()], AHORA);

    expect(resultado.map((p) => p.id)).toEqual(['promo-vigente']);
  });

  it('usa la fecha del sistema cuando no se indica', () => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);

    const vigente = promo({ id: 'promo-vigente' });
    const futura = promo({ id: 'promo-futura', startsAt: new Date('2026-03-01T00:00:00.000Z') });

    const resultado = getApplicablePromotions([vigente, futura], [linea()]);

    expect(resultado.map((p) => p.id)).toEqual(['promo-vigente']);
  });

  it('solo considera las categorías presentes en el carrito', () => {
    const porCategoria = promo({
      id: 'promo-categoria',
      type: 'CATEGORY_PERCENTAGE',
      config: { percent: 10 },
      items: [{ categoryId: 'category-1' }],
    });

    const conCategoria = getApplicablePromotions(
      [porCategoria],
      [linea({ categoryId: 'category-1' })],
      AHORA
    );
    const sinCategoria = getApplicablePromotions(
      [porCategoria],
      [linea({ categoryId: null }), linea({ productId: 'product-2' })],
      AHORA
    );

    expect(conCategoria.map((p) => p.id)).toEqual(['promo-categoria']);
    expect(sinCategoria).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// calculatePromotions — PERCENTAGE / DIRECT_AMOUNT
// ───────────────────────────────────────────────────────────────────────────

describe('calculatePromotions', () => {
  it('sin líneas devuelve todo en cero', () => {
    const resultado = calculatePromotions([], [promo()], AHORA);

    expect(resultado).toEqual({
      lines: [],
      applied: [],
      subtotal: 0,
      subtotalAfterLinePromos: 0,
      tierDiscount: 0,
      total: 0,
    });
  });

  it('sin promociones deja los precios originales', () => {
    const resultado = calculatePromotions([linea({ unitPrice: 100, quantity: 2 })], [], AHORA);

    expect(resultado.lines[0]).toEqual({
      productId: 'product-1',
      unitPrice: 100,
      subtotal: 200,
      originalUnitPrice: 100,
      promotionIds: [],
    });
    expect(resultado.total).toBe(200);
    expect(resultado.applied).toEqual([]);
  });

  it('aplica PERCENTAGE sobre el precio de la línea', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 100, quantity: 2 })],
      [promo({ config: { percent: 10 } })],
      AHORA
    );

    expect(resultado.lines[0]).toEqual({
      productId: 'product-1',
      unitPrice: 90,
      subtotal: 180,
      originalUnitPrice: 100,
      promotionIds: ['promo-1'],
    });
    expect(resultado.subtotal).toBe(200);
    expect(resultado.subtotalAfterLinePromos).toBe(180);
    expect(resultado.tierDiscount).toBe(0);
    expect(resultado.total).toBe(180);
    expect(resultado.applied).toEqual([
      {
        promotionId: 'promo-1',
        promotionName: 'Promo de prueba',
        type: 'PERCENTAGE',
        productId: 'product-1',
        originalAmount: 200,
        discountedAmount: 180,
        savedAmount: 20,
        details: {},
      },
    ]);
  });

  it('aplica PERCENTAGE a todas las líneas cuando no define productos', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 50, quantity: 1 }), linea({ productId: 'product-2', unitPrice: 80 })],
      [promo({ items: [] })],
      AHORA
    );

    expect(resultado.lines.map((l) => l.unitPrice)).toEqual([45, 72]);
    expect(resultado.total).toBe(117);
  });

  it('ignora PERCENTAGE que no incluye el producto de la línea', () => {
    const resultado = calculatePromotions(
      [linea({ productId: 'product-2' })],
      [promo({ items: [{ productId: 'product-1' }] })],
      AHORA
    );

    expect(resultado.lines[0].promotionIds).toEqual([]);
    expect(resultado.total).toBe(100);
  });

  it('descarta PERCENTAGE con porcentaje cero', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 100 })],
      [promo({ config: { percent: 0 } })],
      AHORA
    );

    expect(resultado.applied).toEqual([]);
    expect(resultado.total).toBe(100);
  });

  it('aplica DIRECT_AMOUNT por unidad', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 15, quantity: 3 })],
      [promo({ type: 'DIRECT_AMOUNT', config: { amount: 5 } })],
      AHORA
    );

    expect(resultado.lines[0].unitPrice).toBe(10);
    expect(resultado.lines[0].subtotal).toBe(30);
    expect(resultado.applied[0]).toMatchObject({
      type: 'DIRECT_AMOUNT',
      originalAmount: 45,
      discountedAmount: 30,
      savedAmount: 15,
    });
  });

  it('nunca baja de cero con DIRECT_AMOUNT mayor al precio', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 15, quantity: 1 })],
      [promo({ type: 'DIRECT_AMOUNT', config: { amount: 20 } })],
      AHORA
    );

    expect(resultado.lines[0].unitPrice).toBe(0);
    expect(resultado.lines[0].subtotal).toBe(0);
    expect(resultado.applied[0].savedAmount).toBe(15);
  });

  it('descarta DIRECT_AMOUNT cuando la línea no tiene importe', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 15, quantity: 0 })],
      [promo({ type: 'DIRECT_AMOUNT', config: { amount: 5 } })],
      AHORA
    );

    expect(resultado.lines[0].promotionIds).toEqual([]);
    expect(resultado.applied).toEqual([]);
  });

  // ── N_FOR_DISCOUNT ───────────────────────────────────────────────────────

  it('aplica N_FOR_DISCOUNT en cada N-ésima unidad', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 10, quantity: 4 })],
      [
        promo({
          type: 'N_FOR_DISCOUNT',
          config: { buyQuantity: 2, discountPercent: 50, appliesTo: 'EVERY_NTH' },
        }),
      ],
      AHORA
    );

    // 4 unidades / 2 por grupo = 2 grupos; 2 unidades afectadas al 50% de 10 = 10
    expect(resultado.lines[0].unitPrice).toBe(7.5);
    expect(resultado.lines[0].subtotal).toBe(30);
    expect(resultado.applied[0].savedAmount).toBe(10);
  });

  it('aplica N_FOR_DISCOUNT a todas las unidades después de N', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 10, quantity: 5 })],
      [
        promo({
          type: 'N_FOR_DISCOUNT',
          config: { buyQuantity: 2, discountPercent: 10, appliesTo: 'ALL_AFTER_N' },
        }),
      ],
      AHORA
    );

    // 5 - 2 = 3 unidades afectadas al 10% de 10 = 3
    expect(resultado.lines[0].unitPrice).toBe(9.4);
    expect(resultado.lines[0].subtotal).toBe(47);
    expect(resultado.applied[0].savedAmount).toBe(3);
  });

  it('descarta N_FOR_DISCOUNT si la cantidad no alcanza', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 10, quantity: 1 })],
      [
        promo({
          type: 'N_FOR_DISCOUNT',
          config: { buyQuantity: 2, discountPercent: 50, appliesTo: 'EVERY_NTH' },
        }),
      ],
      AHORA
    );

    expect(resultado.applied).toEqual([]);
    expect(resultado.total).toBe(10);
  });

  it('descarta N_FOR_DISCOUNT con cantidad de compra inválida', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 10, quantity: 6 })],
      [
        promo({
          type: 'N_FOR_DISCOUNT',
          config: { buyQuantity: 0, discountPercent: 50, appliesTo: 'EVERY_NTH' },
        }),
      ],
      AHORA
    );

    expect(resultado.applied).toEqual([]);
  });

  it('descarta N_FOR_DISCOUNT con descuento cero', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 10, quantity: 6 })],
      [
        promo({
          type: 'N_FOR_DISCOUNT',
          config: { buyQuantity: 2, discountPercent: 0, appliesTo: 'EVERY_NTH' },
        }),
      ],
      AHORA
    );

    expect(resultado.applied).toEqual([]);
  });

  // ── N_FOR_FREE ───────────────────────────────────────────────────────────

  it('aplica N_FOR_FREE regalando las unidades correspondientes', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 10, quantity: 2 })],
      [promo({ type: 'N_FOR_FREE', config: { buyQuantity: 1, freeQuantity: 1 } })],
      AHORA
    );

    expect(resultado.lines[0].unitPrice).toBe(5);
    expect(resultado.lines[0].subtotal).toBe(10);
    expect(resultado.applied[0]).toMatchObject({
      type: 'N_FOR_FREE',
      originalAmount: 20,
      discountedAmount: 10,
      savedAmount: 10,
    });
  });

  it('descarta N_FOR_FREE con cantidad gratis inválida', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 10, quantity: 6 })],
      [promo({ type: 'N_FOR_FREE', config: { buyQuantity: 2, freeQuantity: 0 } })],
      AHORA
    );

    expect(resultado.applied).toEqual([]);
  });

  it('descarta N_FOR_FREE si no llega a la cantidad de compra', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 10, quantity: 1 })],
      [promo({ type: 'N_FOR_FREE', config: { buyQuantity: 2, freeQuantity: 1 } })],
      AHORA
    );

    expect(resultado.applied).toEqual([]);
  });

  it('descarta N_FOR_FREE cuando no se completa ningún grupo', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 10, quantity: 3 })],
      [promo({ type: 'N_FOR_FREE', config: { buyQuantity: 3, freeQuantity: 1 } })],
      AHORA
    );

    expect(resultado.lines[0].promotionIds).toEqual([]);
    expect(resultado.total).toBe(30);
  });

  it('descarta N_FOR_FREE cuando el precio es cero', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 0, quantity: 2 })],
      [promo({ type: 'N_FOR_FREE', config: { buyQuantity: 1, freeQuantity: 1 } })],
      AHORA
    );

    expect(resultado.applied).toEqual([]);
  });

  // ── CATEGORY_PERCENTAGE ─────────────────────────────────────────────────

  it('aplica CATEGORY_PERCENTAGE sobre las líneas de la categoría', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 50, quantity: 2, categoryId: 'category-1' })],
      [
        promo({
          type: 'CATEGORY_PERCENTAGE',
          config: { percent: 20 },
          items: [{ categoryId: 'category-1' }],
        }),
      ],
      AHORA
    );

    expect(resultado.lines[0].unitPrice).toBe(40);
    expect(resultado.lines[0].subtotal).toBe(80);
    expect(resultado.applied[0]).toMatchObject({
      type: 'CATEGORY_PERCENTAGE',
      productId: 'product-1',
      originalAmount: 100,
      discountedAmount: 80,
      savedAmount: 20,
    });
  });

  it('descarta CATEGORY_PERCENTAGE si la línea no tiene categoría', () => {
    const resultado = calculatePromotions(
      [linea({ categoryId: null })],
      [
        promo({
          type: 'CATEGORY_PERCENTAGE',
          config: { percent: 20 },
          items: [{ categoryId: 'category-1' }],
        }),
      ],
      AHORA
    );

    expect(resultado.applied).toEqual([]);
    expect(resultado.total).toBe(100);
  });

  it('descarta CATEGORY_PERCENTAGE para otra categoría', () => {
    const resultado = calculatePromotions(
      [linea({ categoryId: 'category-2' })],
      [
        promo({
          type: 'CATEGORY_PERCENTAGE',
          config: { percent: 20 },
          items: [{ categoryId: 'category-1' }],
        }),
      ],
      AHORA
    );

    expect(resultado.applied).toEqual([]);
  });

  it('descarta CATEGORY_PERCENTAGE con porcentaje cero', () => {
    const resultado = calculatePromotions(
      [linea({ categoryId: 'category-1' })],
      [
        promo({
          type: 'CATEGORY_PERCENTAGE',
          config: { percent: 0 },
          items: [{ categoryId: 'category-1' }],
        }),
      ],
      AHORA
    );

    expect(resultado.applied).toEqual([]);
  });

  // ── Prioridad entre promociones ─────────────────────────────────────────

  it('elige la promoción que genera mayor ahorro', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 100, quantity: 1 })],
      [
        promo({ id: 'promo-menor', priority: 99, config: { percent: 10 } }),
        promo({ id: 'promo-mayor', priority: 0, config: { percent: 30 } }),
      ],
      AHORA
    );

    expect(resultado.lines[0].promotionIds).toEqual(['promo-mayor']);
    expect(resultado.lines[0].unitPrice).toBe(70);
  });

  it('desempata por prioridad cuando el ahorro es igual', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 15, quantity: 3 })],
      [
        promo({ id: 'promo-baja', type: 'DIRECT_AMOUNT', config: { amount: 5 }, priority: 1 }),
        promo({ id: 'promo-alta', type: 'DIRECT_AMOUNT', config: { amount: 5 }, priority: 9 }),
      ],
      AHORA
    );

    expect(resultado.lines[0].promotionIds).toEqual(['promo-alta']);
  });

  it('mantiene la primera promoción cuando ahorro y prioridad empatan', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 100, quantity: 1 })],
      [promo({ id: 'promo-1', priority: 0 }), promo({ id: 'promo-2', priority: 0 })],
      AHORA
    );

    expect(resultado.lines[0].promotionIds).toEqual(['promo-1']);
  });

  it('omite la aplicación cuando el ahorro es insignificante', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 10, quantity: 1 })],
      [promo({ type: 'DIRECT_AMOUNT', config: { amount: 0.001 } })],
      AHORA
    );

    expect(resultado.lines[0].promotionIds).toEqual(['promo-1']);
    expect(resultado.applied).toEqual([]);
  });

  // ── COMBO ───────────────────────────────────────────────────────────────

  it('aplica COMBO con precio fijo repartiendo el ahorro proporcionalmente', () => {
    const resultado = calculatePromotions(
      [linea({ productId: 'product-1', unitPrice: 20, quantity: 1 }), linea({ productId: 'product-2', unitPrice: 30, quantity: 1 })],
      [
        promo({
          id: 'combo-1',
          type: 'COMBO',
          config: { comboPrice: 40 },
          items: [{ productId: 'product-1' }, { productId: 'product-2' }],
        }),
      ],
      AHORA
    );

    expect(resultado.lines.map((l) => l.subtotal)).toEqual([16, 24]);
    expect(resultado.lines.map((l) => l.promotionIds)).toEqual([['combo-1'], ['combo-1']]);
    expect(resultado.subtotal).toBe(50);
    expect(resultado.subtotalAfterLinePromos).toBe(40);
    expect(resultado.total).toBe(40);
    expect(resultado.applied).toEqual([
      {
        promotionId: 'combo-1',
        promotionName: 'Promo de prueba',
        type: 'COMBO',
        productId: 'product-1',
        originalAmount: 20,
        discountedAmount: 16,
        savedAmount: 4,
        details: {},
      },
      {
        promotionId: 'combo-1',
        promotionName: 'Promo de prueba',
        type: 'COMBO',
        productId: 'product-2',
        originalAmount: 30,
        discountedAmount: 24,
        savedAmount: 6,
        details: {},
      },
    ]);
  });

  it('aplica COMBO con descuento porcentual', () => {
    const resultado = calculatePromotions(
      [
        linea({ productId: 'product-1', unitPrice: 20, quantity: 1 }),
        linea({ productId: 'product-2', unitPrice: 30, quantity: 1 }),
      ],
      [
        promo({
          id: 'combo-1',
          type: 'COMBO',
          config: { discountPercent: 20 },
          items: [{ productId: 'product-1' }, { productId: 'product-2' }],
        }),
      ],
      AHORA
    );

    expect(resultado.total).toBe(40);
    expect(resultado.applied.map((a) => a.savedAmount)).toEqual([4, 6]);
  });

  it('aplica COMBO a tantos packs como unidades completas haya', () => {
    const resultado = calculatePromotions(
      [
        linea({ productId: 'product-1', unitPrice: 20, quantity: 2 }),
        linea({ productId: 'product-2', unitPrice: 30, quantity: 2 }),
      ],
      [
        promo({
          id: 'combo-1',
          type: 'COMBO',
          config: { comboPrice: 40 },
          items: [{ productId: 'product-1' }, { productId: 'product-2' }],
        }),
      ],
      AHORA
    );

    expect(resultado.subtotal).toBe(100);
    expect(resultado.lines.map((l) => l.unitPrice)).toEqual([16, 24]);
    expect(resultado.total).toBe(80);
  });

  it('ignora el comboPrice por producto y usa el del config', () => {
    const resultado = calculatePromotions(
      [
        linea({ productId: 'product-1', unitPrice: 20, quantity: 1 }),
        linea({ productId: 'product-2', unitPrice: 30, quantity: 1 }),
      ],
      [
        promo({
          id: 'combo-1',
          type: 'COMBO',
          config: { comboPrice: 40 },
          items: [
            { productId: 'product-1', comboPrice: 15 },
            { productId: 'product-2', comboPrice: 25 },
          ],
        }),
      ],
      AHORA
    );

    expect(resultado.total).toBe(40);
    expect(resultado.lines.map((l) => l.subtotal)).toEqual([16, 24]);
  });

  it('no aplica COMBO si falta un producto del pack', () => {
    const resultado = calculatePromotions(
      [linea({ productId: 'product-1', unitPrice: 20, quantity: 1 })],
      [
        promo({
          id: 'combo-1',
          type: 'COMBO',
          config: { comboPrice: 25 },
          items: [{ productId: 'product-1' }, { productId: 'product-2' }],
        }),
      ],
      AHORA
    );

    expect(resultado.lines[0].promotionIds).toEqual([]);
    expect(resultado.total).toBe(20);
    expect(resultado.applied).toEqual([]);
  });

  it('no aplica COMBO con menos de dos productos configurados', () => {
    const resultado = calculatePromotions(
      [linea({ productId: 'product-1', unitPrice: 20, quantity: 2 })],
      [
        promo({
          id: 'combo-1',
          type: 'COMBO',
          config: { comboPrice: 25 },
          items: [{ productId: 'product-1' }],
        }),
      ],
      AHORA
    );

    expect(resultado.total).toBe(40);
  });

  it('no aplica COMBO sin unidades completas', () => {
    const resultado = calculatePromotions(
      [
        linea({ productId: 'product-1', unitPrice: 20, quantity: 0.5 }),
        linea({ productId: 'product-2', unitPrice: 30, quantity: 0.5 }),
      ],
      [
        promo({
          id: 'combo-1',
          type: 'COMBO',
          config: { comboPrice: 25 },
          items: [{ productId: 'product-1' }, { productId: 'product-2' }],
        }),
      ],
      AHORA
    );

    expect(resultado.total).toBe(25);
    expect(resultado.applied).toEqual([]);
  });

  it('no aplica COMBO sin precio ni porcentaje configurado', () => {
    const resultado = calculatePromotions(
      [
        linea({ productId: 'product-1', unitPrice: 20, quantity: 1 }),
        linea({ productId: 'product-2', unitPrice: 30, quantity: 1 }),
      ],
      [
        promo({
          id: 'combo-1',
          type: 'COMBO',
          config: {},
          items: [{ productId: 'product-1' }, { productId: 'product-2' }],
        }),
      ],
      AHORA
    );

    expect(resultado.total).toBe(50);
  });

  it('no aplica COMBO cuando no representa un ahorro', () => {
    const resultado = calculatePromotions(
      [
        linea({ productId: 'product-1', unitPrice: 20, quantity: 1 }),
        linea({ productId: 'product-2', unitPrice: 30, quantity: 1 }),
      ],
      [
        promo({
          id: 'combo-1',
          type: 'COMBO',
          config: { comboPrice: 60 },
          items: [{ productId: 'product-1' }, { productId: 'product-2' }],
        }),
      ],
      AHORA
    );

    expect(resultado.total).toBe(50);
    expect(resultado.applied).toEqual([]);
  });

  it('combina COMBO con una promo por línea y reparte los montos', () => {
    const resultado = calculatePromotions(
      [
        linea({ productId: 'product-1', unitPrice: 100, quantity: 1 }),
        linea({ productId: 'product-2', unitPrice: 100, quantity: 1 }),
      ],
      [
        promo({ id: 'perc-1', config: { percent: 10 }, items: [{ productId: 'product-1' }] }),
        promo({
          id: 'combo-1',
          type: 'COMBO',
          config: { discountPercent: 20 },
          items: [{ productId: 'product-1' }, { productId: 'product-2' }],
        }),
      ],
      AHORA
    );

    expect(resultado.lines[0].promotionIds).toEqual(['perc-1', 'combo-1']);
    expect(resultado.lines[0].subtotal).toBe(80);
    expect(resultado.lines[1].subtotal).toBe(80);
    expect(resultado.total).toBe(160);

    const deLinea1 = resultado.applied.filter((a) => a.productId === 'product-1');
    expect(deLinea1).toHaveLength(2);
    expect(deLinea1.map((a) => a.savedAmount)).toEqual([10, 10]);
    expect(deLinea1.map((a) => a.originalAmount)).toEqual([50, 50]);
    expect(deLinea1.map((a) => a.discountedAmount)).toEqual([40, 40]);

    const deLinea2 = resultado.applied.filter((a) => a.productId === 'product-2');
    expect(deLinea2).toHaveLength(1);
    expect(deLinea2[0]).toMatchObject({
      promotionId: 'combo-1',
      originalAmount: 100,
      discountedAmount: 80,
      savedAmount: 20,
    });
  });

  // ── TIERED_BY_AMOUNT ────────────────────────────────────────────────────

  const escalones: PromotionConfig = {
    tiers: [
      { minAmount: 0, percent: 5 },
      { minAmount: 100, percent: 10 },
      { minAmount: 200, percent: 15 },
    ],
  };

  it('aplica TIERED_BY_AMOUNT en el escalón que corresponde', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 150, quantity: 1 })],
      [promo({ id: 'tier-1', type: 'TIERED_BY_AMOUNT', config: escalones, items: [] })],
      AHORA
    );

    expect(resultado.subtotal).toBe(150);
    expect(resultado.tierDiscount).toBe(15);
    expect(resultado.total).toBe(135);
    expect(resultado.applied).toEqual([
      {
        promotionId: 'tier-1',
        promotionName: 'Promo de prueba',
        type: 'TIERED_BY_AMOUNT',
        productId: null,
        originalAmount: 150,
        discountedAmount: 135,
        savedAmount: 15,
        details: { minAmount: 100, percent: 10 },
      },
    ]);
  });

  it('no aplica TIERED_BY_AMOUNT por debajo del primer escalón', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 50, quantity: 1 })],
      [
        promo({
          id: 'tier-1',
          type: 'TIERED_BY_AMOUNT',
          config: { tiers: [{ minAmount: 100, percent: 10 }] },
          items: [],
        }),
      ],
      AHORA
    );

    expect(resultado.tierDiscount).toBe(0);
    expect(resultado.total).toBe(50);
    expect(resultado.applied).toEqual([]);
  });

  it('aplica TIERED_BY_AMOUNT justo en el límite del escalón', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 100, quantity: 1 })],
      [
        promo({
          id: 'tier-1',
          type: 'TIERED_BY_AMOUNT',
          config: { tiers: [{ minAmount: 100, percent: 10 }] },
          items: [],
        }),
      ],
      AHORA
    );

    expect(resultado.tierDiscount).toBe(10);
    expect(resultado.total).toBe(90);
  });

  it('aplica el último escalón cuando el subtotal lo supera', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 500, quantity: 1 })],
      [promo({ id: 'tier-1', type: 'TIERED_BY_AMOUNT', config: escalones, items: [] })],
      AHORA
    );

    expect(resultado.tierDiscount).toBe(75);
    expect(resultado.total).toBe(425);
    expect(resultado.applied[0].details).toEqual({ minAmount: 200, percent: 15 });
  });

  it('evalúa TIERED_BY_AMOUNT sobre el subtotal sin promos de línea', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 100, quantity: 1 })],
      [
        promo({ id: 'perc-1', config: { percent: 10 } }),
        promo({
          id: 'tier-1',
          type: 'TIERED_BY_AMOUNT',
          config: { tiers: [{ minAmount: 90, percent: 10 }] },
          items: [],
        }),
      ],
      AHORA
    );

    expect(resultado.subtotal).toBe(100);
    expect(resultado.subtotalAfterLinePromos).toBe(90);
    expect(resultado.tierDiscount).toBe(10);
    expect(resultado.total).toBe(80);
    expect(resultado.applied).toHaveLength(2);
    expect(resultado.applied[1]).toMatchObject({
      promotionId: 'tier-1',
      originalAmount: 90,
      discountedAmount: 80,
      savedAmount: 10,
      details: { minAmount: 90, percent: 10 },
    });
  });

  it('no registra el escalón si el subtotal con promos queda por debajo', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 100, quantity: 1 })],
      [
        promo({ id: 'direct-1', type: 'DIRECT_AMOUNT', config: { amount: 50 } }),
        promo({
          id: 'tier-1',
          type: 'TIERED_BY_AMOUNT',
          config: { tiers: [{ minAmount: 100, percent: 10 }] },
          items: [],
        }),
      ],
      AHORA
    );

    expect(resultado.tierDiscount).toBe(10);
    expect(resultado.total).toBe(40);
    expect(resultado.applied.map((a) => a.promotionId)).toEqual(['direct-1']);
  });

  it('usa solo la primera promoción de escalones', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 200, quantity: 1 })],
      [
        promo({
          id: 'tier-1',
          type: 'TIERED_BY_AMOUNT',
          config: { tiers: [{ minAmount: 100, percent: 10 }] },
          items: [],
        }),
        promo({
          id: 'tier-2',
          type: 'TIERED_BY_AMOUNT',
          config: { tiers: [{ minAmount: 100, percent: 50 }] },
          items: [],
        }),
      ],
      AHORA
    );

    expect(resultado.tierDiscount).toBe(20);
    expect(resultado.applied.map((a) => a.promotionId)).toEqual(['tier-1']);
  });

  // ── Casos límite generales ──────────────────────────────────────────────

  it('ignora las promociones desactivadas', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: 100 })],
      [promo({ isActive: false })],
      AHORA
    );

    expect(resultado.total).toBe(100);
    expect(resultado.applied).toEqual([]);
  });

  it('normaliza a cero los montos no finitos', () => {
    const resultado = calculatePromotions(
      [linea({ unitPrice: Number.NaN, quantity: 2 })],
      [],
      AHORA
    );

    expect(resultado.subtotal).toBe(0);
    expect(resultado.subtotalAfterLinePromos).toBe(0);
    expect(resultado.total).toBe(0);
  });

  it('usa la fecha del sistema cuando no se indica', () => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);

    const resultado = calculatePromotions([linea({ unitPrice: 100 })], [promo()]);

    expect(resultado.total).toBe(90);
  });

  it('acumula varias líneas con promociones distintas', () => {
    const resultado = calculatePromotions(
      [
        linea({ productId: 'product-1', unitPrice: 100, quantity: 1 }),
        linea({ productId: 'product-2', unitPrice: 200, quantity: 1 }),
      ],
      [
        promo({ id: 'promo-1', config: { percent: 10 }, items: [{ productId: 'product-1' }] }),
        promo({ id: 'promo-2', type: 'DIRECT_AMOUNT', config: { amount: 50 }, items: [{ productId: 'product-2' }] }),
      ],
      AHORA
    );

    expect(resultado.lines.map((l) => l.subtotal)).toEqual([90, 150]);
    expect(resultado.subtotal).toBe(300);
    expect(resultado.subtotalAfterLinePromos).toBe(240);
    expect(resultado.total).toBe(240);
    expect(resultado.applied.map((a) => a.promotionId)).toEqual(['promo-1', 'promo-2']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// toLite
// ───────────────────────────────────────────────────────────────────────────

describe('toLite', () => {
  it('convierte la promoción de Prisma al formato del motor', () => {
    const lite = toLite(filaPromo() as never);

    expect(lite).toEqual({
      id: 'promo-1',
      name: 'Promo de prueba',
      type: 'PERCENTAGE',
      config: { percent: 10 },
      startsAt: INICIO,
      endsAt: FIN,
      weekdays: ['MONDAY', 'FRIDAY'],
      timeFrom: '09:00',
      timeTo: '18:00',
      isActive: true,
      priority: 3,
      maxUses: 10,
      usesCount: 2,
      items: [
        { productId: 'product-1', categoryId: null, comboPrice: 25 },
        { productId: null, categoryId: 'category-1', comboPrice: null },
      ],
    });
  });

  it('usa una lista vacía cuando la promoción no tiene días', () => {
    const lite = toLite(filaPromo({ weekdays: null, items: [] }) as never);

    expect(lite.weekdays).toEqual([]);
    expect(lite.items).toEqual([]);
  });
});
