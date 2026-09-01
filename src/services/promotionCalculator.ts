import { Prisma } from '../../generated/prisma/client.js';

/**
 * Tipos compartidos con el frontend. Se serializan como JSON.
 */
export type WeekdayStr =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

export type PromotionTypeStr =
  | 'DIRECT_AMOUNT'
  | 'PERCENTAGE'
  | 'N_FOR_DISCOUNT'
  | 'N_FOR_FREE'
  | 'TIERED_BY_AMOUNT'
  | 'COMBO'
  | 'CATEGORY_PERCENTAGE';

export interface DirectAmountConfig {
  amount: number;
}
export interface PercentageConfig {
  percent: number;
}
export interface NForDiscountConfig {
  buyQuantity: number;
  discountPercent: number;
  appliesTo: 'EVERY_NTH' | 'ALL_AFTER_N';
}
export interface NForFreeConfig {
  buyQuantity: number;
  freeQuantity: number;
}
export interface TieredByAmountTier {
  minAmount: number;
  percent: number;
}
export interface TieredByAmountConfig {
  tiers: TieredByAmountTier[];
}
export interface ComboConfig {
  comboPrice?: number;
  discountPercent?: number;
}
export interface CategoryPercentageConfig {
  percent: number;
}
export type PromotionConfig =
  | DirectAmountConfig
  | PercentageConfig
  | NForDiscountConfig
  | NForFreeConfig
  | TieredByAmountConfig
  | ComboConfig
  | CategoryPercentageConfig;

export interface PromotionItemLite {
  productId?: string | null;
  categoryId?: string | null;
  comboPrice?: number | null;
}

export interface PromotionLite {
  id: string;
  name: string;
  type: PromotionTypeStr;
  config: PromotionConfig;
  startsAt: Date;
  endsAt: Date;
  weekdays: WeekdayStr[];
  timeFrom: string | null;
  timeTo: string | null;
  isActive: boolean;
  priority: number;
  maxUses: number | null;
  usesCount: number;
  items: PromotionItemLite[];
}

export interface CartLineInput {
  productId: string;
  /** Precio de venta normal (sin promo) por unidad o por kg/L. */
  unitPrice: number;
  quantity: number;
  /** Categoría del producto (necesaria para CATEGORY_PERCENTAGE). */
  categoryId?: string | null;
  /** Costo unitario para calcular impacto en margen (opcional). */
  costPrice?: number;
}

export interface AppliedPromotion {
  promotionId: string;
  promotionName: string;
  type: PromotionTypeStr;
  productId: string | null;
  /** Monto original antes de la promo (suma de todas las unidades afectadas). */
  originalAmount: number;
  /** Monto final después de la promo. */
  discountedAmount: number;
  savedAmount: number;
  details: Record<string, unknown>;
}

export interface ResolvedLine {
  productId: string;
  /** Precio unitario final (con promo aplicada, si la hubo). */
  unitPrice: number;
  /** Subtotal final (unitPrice * quantity). */
  subtotal: number;
  /** Precio original sin promo. */
  originalUnitPrice: number;
  /** IDs de promos que afectaron esta línea. */
  promotionIds: string[];
}

export interface PromotionResolution {
  lines: ResolvedLine[];
  applied: AppliedPromotion[];
  /** Subtotal sin descuentos por línea, para evaluar TIERED_BY_AMOUNT. */
  subtotal: number;
  /** Subtotal con descuentos por línea aplicados. */
  subtotalAfterLinePromos: number;
  /** Descuento adicional aplicado al subtotal (por TIERED_BY_AMOUNT). */
  tierDiscount: number;
  /** Total final después de descuentos por línea y por tier. */
  total: number;
}

const WEEKDAY_INDEX: Record<WeekdayStr, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

function parseHHmm(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function timeOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Verifica si una promo está vigente en el instante dado. */
export function isPromotionActive(
  promo: PromotionLite,
  now: Date,
  productIds: Set<string>,
  categoryIds: Set<string>
): boolean {
  if (!promo.isActive) return false;
  if (promo.startsAt.getTime() > now.getTime()) return false;
  if (promo.endsAt.getTime() < now.getTime()) return false;

  // Verifica maxUses
  if (promo.maxUses != null && promo.usesCount >= promo.maxUses) return false;

  // Verifica weekdays (si está definido)
  if (promo.weekdays.length > 0) {
    const dayMatch = promo.weekdays.some(
      (w) => WEEKDAY_INDEX[w] === now.getDay()
    );
    if (!dayMatch) return false;
  }

  // Verifica timeFrom/timeTo
  const from = parseHHmm(promo.timeFrom);
  const to = parseHHmm(promo.timeTo);
  if (from != null || to != null) {
    const t = timeOfDay(now);
    if (from != null && t < from) return false;
    if (to != null && t > to) return false;
  }

  // Verifica que la promo aplique al menos a un producto/categoría del carrito
  if (promo.type === 'CATEGORY_PERCENTAGE') {
    const targetCats = promo.items.map((i) => i.categoryId).filter(Boolean) as string[];
    if (!targetCats.some((c) => categoryIds.has(c))) return false;
  } else if (promo.type !== 'TIERED_BY_AMOUNT') {
    const targetProducts = promo.items.map((i) => i.productId).filter(Boolean) as string[];
    if (targetProducts.length > 0 && !targetProducts.some((p) => productIds.has(p))) {
      return false;
    }
  }
  return true;
}

/** Filtra promos aplicables al instante y al carrito dado. */
export function getApplicablePromotions(
  promos: PromotionLite[],
  lines: CartLineInput[],
  now: Date = new Date()
): PromotionLite[] {
  const productIds = new Set(lines.map((l) => l.productId));
  const categoryIds = new Set(
    lines.map((l) => l.categoryId).filter((c): c is string => Boolean(c))
  );
  return promos.filter((p) => isPromotionActive(p, now, productIds, categoryIds));
}

/**
 * Aplica una promo PERCENTAGE/CATEGORY_PERCENTAGE/DIRECT_AMOUNT a un precio.
 * Retorna el monto descontado (no el nuevo precio).
 */
function discountFromPercent(unitPrice: number, quantity: number, percent: number): number {
  return unitPrice * quantity * (percent / 100);
}
function discountFromAmount(unitPrice: number, quantity: number, amount: number): number {
  return Math.min(unitPrice * quantity, amount * quantity);
}

/**
 * Resuelve todas las promos sobre un carrito, devolviendo líneas con precio
 * ya con promo, y una lista de aplicaciones para persistir.
 *
 * Reglas de prioridad:
 * 1. Si dos promos aplican al mismo producto, gana la de mayor `priority`,
 *    luego la que genere mayor ahorro.
 * 2. CATEGORY_PERCENTAGE y PERCENTAGE sobre el mismo producto: gana la mejor.
 * 3. N_FOR_FREE y N_FOR_DISCOUNT no se combinan entre sí sobre el mismo
 *    producto.
 * 4. TIERED_BY_AMOUNT se evalúa al final sobre el subtotal sin promos por
 *    línea (o con promos ya aplicadas, según `subtotalBase`).
 */
export function calculatePromotions(
  lines: CartLineInput[],
  promos: PromotionLite[],
  now: Date = new Date()
): PromotionResolution {
  const applicable = getApplicablePromotions(promos, lines, now);
  // Excluye COMBO del flujo por línea; se maneja aparte (requiere al menos una
  // unidad de cada producto del combo en el carrito).
  const comboPromos = applicable.filter((p) => p.type === 'COMBO');
  const linePromos = applicable.filter((p) => p.type !== 'COMBO' && p.type !== 'TIERED_BY_AMOUNT');
  const tierPromos = applicable.filter((p) => p.type === 'TIERED_BY_AMOUNT');

  // --- 1. Resolver promos por línea ---
  const resolved: ResolvedLine[] = lines.map((line) => ({
    productId: line.productId,
    unitPrice: line.unitPrice,
    originalUnitPrice: line.unitPrice,
    subtotal: line.unitPrice * line.quantity,
    promotionIds: [],
  }));

  // Calcula candidatos por línea: cada promo genera un descuento posible.
  // Luego elegimos la mejor combinación sin solapamiento.
type Candidate = {
  promo: PromotionLite;
  productId: string | null;
  savedAmount: number;
  newUnitPrice: number;
  details?: Record<string, unknown>;
};

  function candidatesForProduct(productId: string, line: CartLineInput): Candidate[] {
    const result: Candidate[] = [];
    const productCategory = line.categoryId ?? null;
    for (const p of linePromos) {
      if (p.type === 'CATEGORY_PERCENTAGE') {
        const cfg = p.config as CategoryPercentageConfig;
        const cats = p.items.map((i) => i.categoryId).filter(Boolean) as string[];
        if (!productCategory || !cats.includes(productCategory)) continue;
        const saved = discountFromPercent(line.unitPrice, line.quantity, cfg.percent);
        if (saved <= 0) continue;
        result.push({
          promo: p,
          productId: null, // afecta categoría, no producto puntual
          savedAmount: saved,
          newUnitPrice: line.unitPrice * (1 - cfg.percent / 100),
        });
        continue;
      }
      const targetProducts = p.items.map((i) => i.productId).filter(Boolean) as string[];
      if (targetProducts.length > 0 && !targetProducts.includes(productId)) continue;

      if (p.type === 'PERCENTAGE') {
        const cfg = p.config as PercentageConfig;
        const saved = discountFromPercent(line.unitPrice, line.quantity, cfg.percent);
        if (saved <= 0) continue;
        result.push({
          promo: p,
          productId,
          savedAmount: saved,
          newUnitPrice: line.unitPrice * (1 - cfg.percent / 100),
        });
      } else if (p.type === 'DIRECT_AMOUNT') {
        const cfg = p.config as DirectAmountConfig;
        const saved = discountFromAmount(line.unitPrice, line.quantity, cfg.amount);
        if (saved <= 0) continue;
        const newSubtotal = Math.max(0, line.unitPrice * line.quantity - saved);
        const newUnitPrice = line.quantity > 0 ? newSubtotal / line.quantity : line.unitPrice;
        result.push({ promo: p, productId, savedAmount: saved, newUnitPrice });
      } else if (p.type === 'N_FOR_DISCOUNT') {
        const cfg = p.config as NForDiscountConfig;
        if (cfg.buyQuantity <= 0 || line.quantity < cfg.buyQuantity) continue;
        const groups = Math.floor(line.quantity / cfg.buyQuantity);
        if (groups <= 0) continue;
        // Descuento sobre cada N-ésima unidad.
        const totalUnitsAffected =
          cfg.appliesTo === 'EVERY_NTH' ? groups : Math.max(0, line.quantity - cfg.buyQuantity);
        const saved = totalUnitsAffected * line.unitPrice * (cfg.discountPercent / 100);
        if (saved <= 0) continue;
        const newSubtotal = Math.max(0, line.unitPrice * line.quantity - saved);
        const newUnitPrice = line.quantity > 0 ? newSubtotal / line.quantity : line.unitPrice;
        result.push({
          promo: p,
          productId,
          savedAmount: saved,
          newUnitPrice,
          details: { groups, totalUnitsAffected, rule: cfg.appliesTo },
        });
      } else if (p.type === 'N_FOR_FREE') {
        const cfg = p.config as NForFreeConfig;
        if (cfg.freeQuantity <= 0) continue;
        if (line.quantity < cfg.buyQuantity) continue;
        const freeUnits =
          Math.floor(line.quantity / (cfg.buyQuantity + cfg.freeQuantity)) * cfg.freeQuantity;
        if (freeUnits <= 0) continue;
        const saved = freeUnits * line.unitPrice;
        if (saved <= 0) continue;
        const newSubtotal = Math.max(0, line.unitPrice * line.quantity - saved);
        const newUnitPrice = line.quantity > 0 ? newSubtotal / line.quantity : line.unitPrice;
        result.push({
          promo: p,
          productId,
          savedAmount: saved,
          newUnitPrice,
          details: { freeUnits, rule: `${cfg.buyQuantity}+${cfg.freeQuantity}` },
        });
      }
    }
    return result;
  }

  // Para cada línea, elegimos el mejor candidato (mayor ahorro; empate: mayor
  // prioridad, luego mayor savedAmount). No combinamos múltiples promos sobre
  // la misma línea para evitar descuentos叠加 (este es el comportamiento
  // esperado para esta primera versión).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const candidates = candidatesForProduct(line.productId, line);
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => {
      if (b.savedAmount !== a.savedAmount) return b.savedAmount - a.savedAmount;
      if (b.promo.priority !== a.promo.priority) return b.promo.priority - a.promo.priority;
      return 0;
    });
    const best = candidates[0];
    resolved[i].unitPrice = round2(best.newUnitPrice);
    resolved[i].subtotal = round2(best.newUnitPrice * line.quantity);
    resolved[i].promotionIds = [best.promo.id];
  }

  // --- 2. Resolver combos ---
  // Un combo aplica si el carrito tiene al menos 1 unidad de cada producto
  // requerido. Si hay varias unidades, se aplica el combo a `min(quantities)`
  // packs. El precio del pack puede ser fijo (comboPrice) o un % de descuento
  // sobre la suma de precios normales.
  for (const combo of comboPromos) {
    const required = combo.items
      .map((i) => i.productId)
      .filter((p): p is string => Boolean(p));
    if (required.length < 2) continue;
    const present = required
      .map((pid) => lines.find((l) => l.productId === pid))
      .filter((l): l is CartLineInput => Boolean(l));
    if (present.length !== required.length) continue;
    const packCount = Math.min(...present.map((l) => Math.floor(l.quantity)));
    if (packCount <= 0) continue;

    const cfg = combo.config as ComboConfig;
    const items = combo.items;
    let originalAmount = 0;
    let discountedAmount = 0;
    for (const l of present) {
      const promoItem = items.find((i) => i.productId === l.productId);
      const itemOriginalPrice = l.unitPrice * packCount;
      originalAmount += itemOriginalPrice;
      if (promoItem && promoItem.comboPrice != null) {
        // Reparte proporcionalmente el comboPrice entre los productos.
        // Aquí lo añadimos a discountedAmount y se ajusta en resolved[].subtotal.
        discountedAmount += 0; // placeholder; se calcula abajo
      }
    }
    if (cfg.comboPrice != null) {
      discountedAmount = cfg.comboPrice * packCount;
    } else if (cfg.discountPercent != null) {
      discountedAmount = originalAmount * (1 - cfg.discountPercent / 100);
    } else {
      continue;
    }
    discountedAmount = round2(discountedAmount);
    originalAmount = round2(originalAmount);
    if (discountedAmount >= originalAmount) continue;
    const saved = round2(originalAmount - discountedAmount);

    // Aplica el descuento a la primera unidad de cada producto del pack
    // (el resto se cobra a precio normal).
    const perProductSavings = saved / present.length;
    for (const l of present) {
      const idx = lines.findIndex((x) => x.productId === l.productId);
      if (idx === -1) continue;
      const lineOriginalSubtotal = resolved[idx].originalUnitPrice * l.quantity;
      const newSubtotal = Math.max(0, lineOriginalSubtotal - perProductSavings);
      const newUnitPrice = l.quantity > 0 ? newSubtotal / l.quantity : resolved[idx].unitPrice;
      resolved[idx].unitPrice = round2(newUnitPrice);
      resolved[idx].subtotal = round2(newSubtotal);
      resolved[idx].promotionIds = [...resolved[idx].promotionIds, combo.id];
    }
  }

  // --- 3. Recalcular subtotales ---
  const subtotal = round2(
    resolved.reduce((a, r) => a + r.originalUnitPrice * (lines.find((l) => l.productId === r.productId)?.quantity ?? 0), 0)
  );
  const subtotalAfterLinePromos = round2(resolved.reduce((a, r) => a + r.subtotal, 0));

  // --- 4. Resolver TIERED_BY_AMOUNT ---
  let tierDiscount = 0;
  for (const tier of tierPromos) {
    const cfg = tier.config as TieredByAmountConfig;
    const sortedTiers = [...cfg.tiers].sort((a, b) => b.minAmount - a.minAmount);
    const match = sortedTiers.find((t) => subtotalAfterLinePromos >= t.minAmount);
    if (!match) continue;
    tierDiscount = round2(subtotalAfterLinePromos * (match.percent / 100));
    break; // toma la primera promo tier aplicable (las demás promos tier se
    // podrían combinar, pero por simplicidad solo aplicamos una).
  }

  const total = round2(subtotalAfterLinePromos - tierDiscount);

  // --- 5. Construir AppliedPromotion[] ---
  const applied: AppliedPromotion[] = [];

  // Aplicaciones por línea
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const r = resolved[i];
    if (r.promotionIds.length === 0) continue;
    const originalAmount = r.originalUnitPrice * line.quantity;
    const discountedAmount = r.subtotal;
    const saved = round2(originalAmount - discountedAmount);
    if (saved <= 0.005) continue;
    for (const promoId of r.promotionIds) {
      const promo = promos.find((p) => p.id === promoId);
      if (!promo) continue;
      const promoSaved =
        r.promotionIds.length === 1
          ? saved
          : round2(saved / r.promotionIds.length);
      applied.push({
        promotionId: promo.id,
        promotionName: promo.name,
        type: promo.type,
        productId: line.productId,
        originalAmount: round2(
          (r.promotionIds.length === 1 ? originalAmount : originalAmount / r.promotionIds.length)
        ),
        discountedAmount: round2(
          r.promotionIds.length === 1
            ? discountedAmount
            : discountedAmount / r.promotionIds.length
        ),
        savedAmount: promoSaved,
        details: {},
      });
    }
  }

  // Aplicaciones por tier
  if (tierDiscount > 0) {
    for (const tier of tierPromos) {
      const cfg = tier.config as TieredByAmountConfig;
      const sortedTiers = [...cfg.tiers].sort((a, b) => b.minAmount - a.minAmount);
      const match = sortedTiers.find((t) => subtotalAfterLinePromos >= t.minAmount);
      if (!match) continue;
      applied.push({
        promotionId: tier.id,
        promotionName: tier.name,
        type: 'TIERED_BY_AMOUNT',
        productId: null,
        originalAmount: subtotalAfterLinePromos,
        discountedAmount: round2(subtotalAfterLinePromos - tierDiscount),
        savedAmount: tierDiscount,
        details: { minAmount: match.minAmount, percent: match.percent },
      });
      break;
    }
  }

  return {
    lines: resolved,
    applied,
    subtotal,
    subtotalAfterLinePromos,
    tierDiscount,
    total,
  };
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/** Serializa una promo al formato lite para el motor. */
export function toLite(
  promo: Prisma.PromotionGetPayload<{ include: { items: true } }>
): PromotionLite {
  return {
    id: promo.id,
    name: promo.name,
    type: promo.type as PromotionTypeStr,
    config: promo.config as PromotionConfig,
    startsAt: promo.startsAt,
    endsAt: promo.endsAt,
    weekdays: (promo.weekdays ?? []) as WeekdayStr[],
    timeFrom: promo.timeFrom,
    timeTo: promo.timeTo,
    isActive: promo.isActive,
    priority: promo.priority,
    maxUses: promo.maxUses,
    usesCount: promo.usesCount,
    items: promo.items.map((i) => ({
      productId: i.productId,
      categoryId: i.categoryId,
      comboPrice: i.comboPrice == null ? null : Number(i.comboPrice),
    })),
  };
}
