import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import {
  colombiaStartOfDay,
  colombiaEndOfDay,
  colombiaLocalDateKey,
  COLOMBIA_OFFSET_MS,
} from '../utils/dates';
import { getInventoryReport } from './stockMovement.service';

async function validateStore(storeId: string): Promise<void> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw ApiError.notFound('Tienda no encontrada', 'STORE_NOT_FOUND');
}

const saleInclude = {
  items: { include: { product: true } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.SaleInclude;

const cancellationInclude = {
  user: { select: { id: true, name: true } },
  cancellationReason: true,
} satisfies Prisma.CancellationInclude;

/**
 * Ajuste por cancelaciones PARCIALES de ventas dentro de un rango.
 * Las ventas totalmente canceladas (status CANCELED) ya se excluyen vía el
 * filtro `status: 'COMPLETED'`, así que aquí solo restamos las parciales,
 * tanto a nivel de monto (total) como de ganancia (profit de sus ítems).
 */
async function partialSaleCancellationAdjustment(
  storeId: string,
  desde: Date,
  hasta: Date
): Promise<{ revenue: number; profit: number; bySale: Map<string, number> }> {
  const cancellations = await prisma.cancellation.findMany({
    where: {
      storeId,
      entityType: 'SALE',
      type: 'PARTIAL',
      createdAt: { gte: desde, lte: hasta },
    },
    select: {
      entityId: true,
      total: true,
      items: { select: { profit: true } },
    },
  });

  let revenue = 0;
  let profit = 0;
  const bySale = new Map<string, number>();
  for (const c of cancellations) {
    const t = Number(c.total);
    revenue += t;
    profit += c.items.reduce((b, i) => b + Number(i.profit), 0);
    bySale.set(c.entityId, (bySale.get(c.entityId) ?? 0) + t);
  }
  return { revenue, profit, bySale };
}

export async function dailyReport(storeId: string, date?: string) {
  await validateStore(storeId);

  const sales = await prisma.sale.findMany({
    where: {
      storeId,
      status: 'COMPLETED',
      createdAt: { gte: colombiaStartOfDay(date), lte: colombiaEndOfDay(date) },
    },
  });

  const totalSales = sales.reduce((sum, s) => sum + Number(s.total), 0);
  const totalProfitBruta = sales.reduce((sum, s) => sum + Number(s.profit), 0);
  const count = sales.length;

  const adj = await partialSaleCancellationAdjustment(
    storeId,
    colombiaStartOfDay(date),
    colombiaEndOfDay(date)
  );
  const totalRevenue = Math.max(0, totalSales - adj.revenue);
  const totalProfit = Math.max(0, totalProfitBruta - adj.profit);

  const salesByPayment: Record<string, number> = {};
  for (const s of sales) {
    const key = s.paymentMethod;
    salesByPayment[key] = (salesByPayment[key] ?? 0) + Number(s.total);
  }

  const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  return {
    storeId,
    date: colombiaStartOfDay(date).toISOString().slice(0, 10),
    salesCount: count,
    totalRevenue,
    totalProfit,
    profitMargin,
    averageTicket: count > 0 ? totalRevenue / count : 0,
    salesByPayment,
  };
}

export async function monthlyReport(storeId: string, month?: string) {
  await validateStore(storeId);

  let year: number;
  let monthIdx: number;
  if (month) {
    const parsed = /^(\d{4})-(\d{2})/.exec(month);
    if (!parsed) throw ApiError.badRequest('Mes inválido', 'INVALID_DATE');
    year = Number(parsed[1]);
    monthIdx = Number(parsed[2]) - 1;
    if (monthIdx < 0 || monthIdx > 11) {
      throw ApiError.badRequest('Mes inválido', 'INVALID_DATE');
    }
  } else {
    const now = new Date(Date.now() + COLOMBIA_OFFSET_MS);
    year = now.getUTCFullYear();
    monthIdx = now.getUTCMonth();
  }

  const firstKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const lastKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const sales = await prisma.sale.findMany({
    where: {
      storeId,
      status: 'COMPLETED',
      createdAt: { gte: colombiaStartOfDay(firstKey), lte: colombiaEndOfDay(lastKey) },
    },
    select: { createdAt: true, total: true, profit: true },
  });

  const perDay = new Map<
    string,
    { salesCount: number; totalRevenue: number; totalProfit: number }
  >();
  for (const sale of sales) {
    const dayKey = colombiaLocalDateKey(sale.createdAt);
    const entry = perDay.get(dayKey) ?? { salesCount: 0, totalRevenue: 0, totalProfit: 0 };
    entry.salesCount += 1;
    entry.totalRevenue += Number(sale.total);
    entry.totalProfit += Number(sale.profit);
    perDay.set(dayKey, entry);
  }

  // Restar cancelaciones parciales de ventas según el día en que se cancelaron.
  const cancelacionesParciales = await prisma.cancellation.findMany({
    where: {
      storeId,
      entityType: 'SALE',
      type: 'PARTIAL',
      createdAt: { gte: colombiaStartOfDay(firstKey), lte: colombiaEndOfDay(lastKey) },
    },
    select: { createdAt: true, total: true, items: { select: { profit: true } } },
  });
  for (const c of cancelacionesParciales) {
    const dayKey = colombiaLocalDateKey(c.createdAt);
    const entry = perDay.get(dayKey);
    if (entry) {
      const rev = Number(c.total);
      const prof = c.items.reduce((b, i) => b + Number(i.profit), 0);
      entry.totalRevenue = Math.max(0, entry.totalRevenue - rev);
      entry.totalProfit = Math.max(0, entry.totalProfit - prof);
    }
  }

  return Array.from(perDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, v]) => ({
      month: dayKey,
      totalRevenue: v.totalRevenue,
      totalProfit: v.totalProfit,
      profitMargin: v.totalRevenue > 0 ? (v.totalProfit / v.totalRevenue) * 100 : 0,
      salesCount: v.salesCount,
    }));
}

export async function corteCaja(
  storeId: string,
  date?: string,
  startDate?: string,
  endDate?: string,
  operatorId?: string
) {
  await validateStore(storeId);

  // Anclar a día de Colombia: el rango [desde, hasta] cubre el día calendario
  // completo de Colombia sin importar la zona horaria del servidor.
  const desde = startDate ? colombiaStartOfDay(startDate) : colombiaStartOfDay(date);
  const hasta = endDate ? colombiaEndOfDay(endDate) : colombiaEndOfDay(date);

  const whereSale: Prisma.SaleWhereInput = {
    storeId,
    status: 'COMPLETED',
    createdAt: { gte: desde, lte: hasta },
  };
  if (operatorId) whereSale.userId = operatorId;

  const sales = await prisma.sale.findMany({
    where: whereSale,
    include: saleInclude,
    orderBy: { createdAt: 'desc' },
  });

  // Ajuste por ventas parcialmente canceladas: monto neto por venta.
  const adj = await partialSaleCancellationAdjustment(storeId, desde, hasta);
  const saleNetTotal = new Map<string, number>();
  for (const s of sales) {
    const ajuste = adj.bySale.get(s.id) ?? 0;
    saleNetTotal.set(s.id, Math.max(0, Number(s.total) - ajuste));
  }

  const ventasDetalle = sales.map((sale) => ({
    id: sale.id,
    saleNumber: sale.saleNumber,
    createdAt: sale.createdAt.toISOString(),
    userId: sale.userId,
    userName: sale.user?.name ?? '—',
    total: saleNetTotal.get(sale.id) ?? 0,
    discount: Number(sale.discount),
    paymentMethod: sale.paymentMethod,
    status: sale.status,
    items: sale.items.map((it) => ({
      productName: it.product?.name ?? 'Producto',
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      unidad: it.product?.unidadVenta ?? null,
    })),
  }));

  const totalRevenueBruta = sales.reduce((a, s) => a + Number(s.total), 0);
  const totalDiscount = sales.reduce((a, s) => a + Number(s.discount), 0);
  const totalProfitBruta = sales.reduce((a, s) => a + Number(s.profit), 0);
  const salesCount = sales.length;

  // "Total vendido" = cantidad total de ventas (bruto).
  // "Efectivo esperado en caja" = total vendido - cancelaciones parciales.
  const totalRevenue = totalRevenueBruta;
  const cashExpectedNeto = Math.max(0, totalRevenueBruta - adj.revenue);
  const totalProfit = Math.max(0, totalProfitBruta - adj.profit);
  const averageTicket = salesCount > 0 ? totalRevenueBruta / salesCount : 0;

  const salesByPayment: Record<string, { count: number; total: number }> = {};
  for (const s of sales) {
    const key = s.paymentMethod;
    const e = salesByPayment[key] ?? { count: 0, total: 0 };
    e.count += 1;
    e.total += saleNetTotal.get(s.id) ?? 0;
    salesByPayment[key] = e;
  }
  const cashExpected = cashExpectedNeto;

  const cancelaciones = await prisma.cancellation.findMany({
    where: { storeId, createdAt: { gte: desde, lte: hasta } },
    include: cancellationInclude,
    orderBy: { createdAt: 'desc' },
  });

  const cancellations = cancelaciones.map((c) => ({
    id: c.id,
    entityType: c.entityType,
    entityId: c.entityId,
    entityNumber: c.entityNumber,
    type: (c.type === 'PARTIAL' ? 'PARTIAL' : 'FULL') as 'FULL' | 'PARTIAL',
    total: Number(c.total),
    reason: c.cancellationReason?.name ?? '—',
    comment: c.comment ?? null,
    createdAt: c.createdAt.toISOString(),
    userName: c.user?.name ?? '—',
    items: [],
  }));

  const cancelledCount = cancelaciones.length;
  const cancelledAmount = cancelaciones.reduce((a, c) => a + Number(c.total), 0);
  const partialCancelledCount = cancelaciones.filter((c) => c.type === 'PARTIAL').length;
  const cancelledCountByOperator = operatorId
    ? cancelaciones.filter((c) => c.userId === operatorId).length
    : 0;

  const inventario = await getInventoryReport(storeId, startDate ?? date);

  const fechaRef = startDate ?? date ?? colombiaLocalDateKey(new Date());

  const esDiaUnico = colombiaLocalDateKey(desde) === colombiaLocalDateKey(hasta);

  const byHour: { hour: number; count: number; totalRevenue: number }[] = [];
  const byDay: { date: string; count: number; totalRevenue: number }[] = [];

  if (esDiaUnico) {
    const porHora = new Map<number, { count: number; total: number }>();
    for (const s of sales) {
      const hora = new Date(s.createdAt.getTime() + COLOMBIA_OFFSET_MS).getUTCHours();
      const e = porHora.get(hora) ?? { count: 0, total: 0 };
      e.count += 1;
      e.total += saleNetTotal.get(s.id) ?? 0;
      porHora.set(hora, e);
    }
    for (let h = 0; h < 24; h++) {
      const e = porHora.get(h);
      byHour.push({ hour: h, count: e?.count ?? 0, totalRevenue: e?.total ?? 0 });
    }
  } else {
    const porDia = new Map<string, { count: number; total: number }>();
    for (const s of sales) {
      const dk = colombiaLocalDateKey(s.createdAt);
      const e = porDia.get(dk) ?? { count: 0, total: 0 };
      e.count += 1;
      e.total += saleNetTotal.get(s.id) ?? 0;
      porDia.set(dk, e);
    }
    for (const [dk, e] of [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      byDay.push({ date: dk, count: e.count, totalRevenue: e.total });
    }
  }

  return {
    storeId,
    date: fechaRef,
    generatedAt: new Date().toISOString(),
    salesCount,
    cancelledCount,
    cancelledCountByOperator,
    totalRevenue,
    totalDiscount,
    totalProfit,
    averageTicket,
    cashExpected,
    salesByPayment,
    byHour,
    byDay,
    sales: ventasDetalle,
    cancelledSales: [],
    cancelledAmount,
    partialCancelledCount,
    cancellations,
    inventario,
  };
}

export async function productsReport(storeId: string) {
  const saleItems = await prisma.saleItem.findMany({
    where: { sale: { storeId, status: 'COMPLETED' }, canceledAt: null },
    include: { product: { include: { category: true } } },
  });

  const perProduct = new Map<
    string,
    { productId: string; name: string; category: string | null; quantity: number; revenue: number; profit: number }
  >();
  for (const item of saleItems) {
    const entry =
      perProduct.get(item.productId) ?? {
        productId: item.productId,
        name: item.product.name,
        category: item.product.category?.name ?? null,
        quantity: 0,
        revenue: 0,
        profit: 0,
      };
    entry.quantity += Number(item.quantity);
    entry.revenue += Number(item.unitPrice) * Number(item.quantity);
    entry.profit += Number(item.profit);
    perProduct.set(item.productId, entry);
  }

  return Array.from(perProduct.values())
    .map((p) => ({
      productId: p.productId,
      productName: p.name,
      quantitySold: p.quantity,
      revenue: p.revenue,
      profit: p.profit,
      profitMargin: p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export async function profitMarginByCategory(storeId: string) {
  await validateStore(storeId);

  const saleItems = await prisma.saleItem.findMany({
    where: { sale: { storeId, status: 'COMPLETED' }, canceledAt: null },
    include: { product: { include: { category: true } } },
  });

  const perCategory = new Map<string, { revenue: number; profit: number }>();
  for (const item of saleItems) {
    const catName = item.product.category?.name ?? 'Sin categoría';
    const entry = perCategory.get(catName) ?? { revenue: 0, profit: 0 };
    entry.revenue += Number(item.unitPrice) * Number(item.quantity);
    entry.profit += Number(item.profit);
    perCategory.set(catName, entry);
  }

  return Array.from(perCategory.entries()).map(([name, v]) => ({
    category: name,
    revenue: v.revenue,
    cost: v.revenue - v.profit,
    profit: v.profit,
    profitMargin: v.revenue > 0 ? (v.profit / v.revenue) * 100 : 0,
  }));
}

export async function suppliersReport(storeId: string) {
  await validateStore(storeId);

  const transactions = await prisma.supplierTransaction.findMany({
    where: { storeId },
    include: { supplier: true },
  });

  const perSupplier = new Map<
    string,
    { supplierId: string; name: string; count: number; total: number }
  >();
  for (const t of transactions) {
    const entry =
      perSupplier.get(t.supplierId) ?? {
        supplierId: t.supplierId,
        name: t.supplier.name,
        count: 0,
        total: 0,
      };
    entry.count += 1;
    entry.total += Number(t.total);
    perSupplier.set(t.supplierId, entry);
  }

  return Array.from(perSupplier.values())
    .map((s) => ({
      supplierId: s.supplierId,
      supplierName: s.name,
      totalPurchases: s.count,
      totalSpent: s.total,
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent);
}
