import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { getInventoryReport } from './stockMovement.service';

// Colombia es UTC-5 y no tiene horario de verano. Anclar los límites del día
// a esta zona evita que las ventas de la tarde/noche queden en el día
// siguiente del corte cuando el servidor corre en otra zona horaria.
const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000;

function colombiaDateParts(dateStr?: string): { y: number; mo: number; d: number } {
  if (dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) throw ApiError.badRequest('Fecha inválida', 'INVALID_DATE');
    return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
  }
  // Fecha actual en Colombia, independiente de la zona del servidor.
  const col = new Date(Date.now() + COLOMBIA_OFFSET_MS);
  return { y: col.getUTCFullYear(), mo: col.getUTCMonth(), d: col.getUTCDate() };
}

function startOfDay(dateStr?: string): Date {
  const { y, mo, d } = colombiaDateParts(dateStr);
  // Mediana noche de Colombia expresada como instante UTC.
  return new Date(Date.UTC(y, mo, d) + COLOMBIA_OFFSET_MS);
}

function endOfDay(dateStr?: string): Date {
  return new Date(startOfDay(dateStr).getTime() + 24 * 60 * 60 * 1000 - 1);
}

function localDateKey(d: Date): string {
  const col = new Date(d.getTime() + COLOMBIA_OFFSET_MS);
  const y = col.getUTCFullYear();
  const m = String(col.getUTCMonth() + 1).padStart(2, '0');
  const day = String(col.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function validateStore(storeId: string): Promise<void> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw ApiError.notFound('Tienda no encontrada', 'STORE_NOT_FOUND');
}

export async function dailyReport(storeId: string, date?: string) {
  await validateStore(storeId);

  const sales = await prisma.sale.findMany({
    where: {
      storeId,
      status: 'COMPLETED',
      createdAt: { gte: startOfDay(date), lte: endOfDay(date) },
    },
  });

  const totalSales = sales.reduce((sum, s) => sum + Number(s.total), 0);
  const totalProfit = sales.reduce((sum, s) => sum + Number(s.profit), 0);
  const count = sales.length;
  const profitMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  const salesByPayment: Record<string, number> = { CASH: 0, CARD: 0 };
  for (const sale of sales) {
    salesByPayment[sale.paymentMethod] =
      (salesByPayment[sale.paymentMethod] ?? 0) + Number(sale.total);
  }

  const result = {
    storeId,
    date: startOfDay(date).toISOString().slice(0, 10),
    salesCount: count,
    totalRevenue: totalSales,
    totalProfit,
    profitMargin,
    averageTicket: count > 0 ? totalSales / count : 0,
    salesByPayment,
    inventario: await getInventoryReport(storeId, date),
  };

  return result;
}

export async function corteCaja(
  storeId: string,
  date?: string,
  startDate?: string,
  endDate?: string,
  operatorId?: string
) {
  await validateStore(storeId);

  const base = date ?? startDate ?? endDate;
  const desde = startOfDay(startDate ?? base);
  const hasta = endOfDay(endDate ?? base);

  const where: Prisma.SaleWhereInput = {
    storeId,
    status: 'COMPLETED',
    createdAt: { gte: desde, lte: hasta },
  };

  if (operatorId) {
    where.userId = operatorId;
  }

  const sales = await prisma.sale.findMany({
    where,
    include: { items: { include: { product: { include: { category: true } } } }, user: { select: { id: true, name: true } } },
  });

  let totalRevenue = new Prisma.Decimal(0);
  let totalDiscount = new Prisma.Decimal(0);
  let totalProfit = new Prisma.Decimal(0);
  const byPayment = new Map<
    string,
    { count: number; total: Prisma.Decimal }
  >();

  for (const sale of sales) {
    totalRevenue = totalRevenue.plus(sale.total);
    totalDiscount = totalDiscount.plus(sale.discount);
    totalProfit = totalProfit.plus(sale.profit);

    const entry = byPayment.get(sale.paymentMethod) ?? {
      count: 0,
      total: new Prisma.Decimal(0),
    };
    entry.count += 1;
    entry.total = entry.total.plus(sale.total);
    byPayment.set(sale.paymentMethod, entry);
  }

  // Canceladas del día (por fecha de cancelación): no suman en totales,
  // pero se reportan para conciliar el cierre.
  const cancelledCount = await prisma.sale.count({
    where: {
      storeId,
      status: 'CANCELED',
      canceledAt: { gte: desde, lte: hasta },
    },
  });

  // Canceladas del día por operador
  const cancelledCountByOperator = operatorId
    ? await prisma.sale.count({
        where: {
          storeId,
          status: 'CANCELED',
          userId: operatorId,
          canceledAt: { gte: desde, lte: hasta },
        },
      })
    : cancelledCount;

  // Canceladas detalladas para mostrar movimientos
  const cancelledSales = await prisma.sale.findMany({
    where: {
      storeId,
      status: 'CANCELED',
      canceledAt: { gte: desde, lte: hasta },
      ...(operatorId ? { userId: operatorId } : {}),
    },
    include: {
      items: { include: { product: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { canceledAt: 'desc' },
  });

  // Cancelaciones del día (registros de Cancelación: totales y parciales).
  const cancellationRecords = await prisma.cancellation.findMany({
    where: {
      storeId,
      createdAt: { gte: desde, lte: hasta },
      ...(operatorId ? { userId: operatorId } : {}),
    },
    include: {
      user: { select: { name: true } },
      cancellationReason: true,
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const cancelledAmount = cancellationRecords.reduce((s, c) => s + Number(c.total), 0);
  const partialCancelledCount = cancellationRecords.filter((c) => c.type === 'PARTIAL').length;

  // Agrupación por hora (día único) o por día (rango).
  const esDiaUnico = localDateKey(desde) === localDateKey(hasta);

  const byHour = new Map<number, { count: number; totalRevenue: number }>();
  const byDay = new Map<string, { count: number; totalRevenue: number }>();
  for (const sale of sales) {
    if (esDiaUnico) {
      const hour = sale.createdAt.getHours();
      const entry = byHour.get(hour) ?? { count: 0, totalRevenue: 0 };
      entry.count += 1;
      entry.totalRevenue += Number(sale.total);
      byHour.set(hour, entry);
    } else {
      const dayKey = localDateKey(sale.createdAt);
      const entry = byDay.get(dayKey) ?? { count: 0, totalRevenue: 0 };
      entry.count += 1;
      entry.totalRevenue += Number(sale.total);
      byDay.set(dayKey, entry);
    }
  }

  const salesByPayment: Record<string, { count: number; total: number }> = {};
  for (const [method, v] of byPayment.entries()) {
    salesByPayment[method] = { count: v.count, total: Number(v.total) };
  }

  const revenue = Number(totalRevenue);
  const count = sales.length;

  // Individual sales for detail view with reprint capability
  const salesDetail = sales.map((sale) => ({
    id: sale.id,
    saleNumber: sale.saleNumber,
    createdAt: sale.createdAt.toISOString(),
    userId: sale.userId,
    userName: sale.user?.name ?? '—',
    total: Number(sale.total),
    discount: Number(sale.discount),
    paymentMethod: sale.paymentMethod,
    status: sale.status,
    items: sale.items.map((it) => ({
      productName: it.product.name,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      unidad: it.product.unidadVenta,
    })),
  }));

  return {
    storeId,
    date: localDateKey(desde),
    generatedAt: new Date().toISOString(),
    salesCount: count,
    cancelledCount,
    cancelledCountByOperator,
    totalRevenue: revenue,
    totalDiscount: Number(totalDiscount),
    totalProfit: Number(totalProfit),
    averageTicket: count > 0 ? revenue / count : 0,
    cashExpected: salesByPayment.CASH?.total ?? 0,
    salesByPayment,
    byHour: Array.from(byHour.entries())
      .sort(([a], [b]) => a - b)
      .map(([hour, v]) => ({
        hour,
        count: v.count,
        totalRevenue: v.totalRevenue,
      })),
    byDay: Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([day, v]) => ({
        date: day,
        count: v.count,
        totalRevenue: v.totalRevenue,
      })),
    sales: salesDetail,
    cancelledSales: cancelledSales.map((sale) => ({
      id: sale.id,
      saleNumber: sale.saleNumber,
      createdAt: sale.createdAt.toISOString(),
      canceledAt: sale.canceledAt?.toISOString() ?? null,
      userId: sale.userId,
      userName: sale.user?.name ?? '—',
      total: Number(sale.total),
      discount: Number(sale.discount),
      paymentMethod: sale.paymentMethod,
      items: sale.items.map((it) => ({
        productName: it.product.name,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        unidad: it.product.unidadVenta,
      })),
    })),
    cancelledAmount: Number(cancelledAmount),
    partialCancelledCount,
    cancellations: cancellationRecords.map((c) => ({
      id: c.id,
      entityType: c.entityType,
      entityId: c.entityId,
      entityNumber: c.entityNumber,
      type: c.type,
      total: Number(c.total),
      reason: c.cancellationReason?.name ?? '—',
      comment: c.comment,
      createdAt: c.createdAt.toISOString(),
      userName: c.user?.name ?? '—',
      items: c.items.map((it) => ({
        productName: it.productName,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        unidad: it.unidad,
        subtotal: Number(it.subtotal),
      })),
    })),
    inventario: await getInventoryReport(storeId, startDate ?? date),
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
    const now = new Date();
    year = now.getFullYear();
    monthIdx = now.getMonth();
  }

  const sales = await prisma.sale.findMany({
    where: {
      storeId,
      status: 'COMPLETED',
      createdAt: {
        gte: new Date(year, monthIdx, 1),
        lte: new Date(year, monthIdx + 1, 0, 23, 59, 59, 999),
      },
    },
    select: { createdAt: true, total: true, profit: true },
  });

  const perDay = new Map<
    string,
    { salesCount: number; totalRevenue: number; totalProfit: number }
  >();

  for (const sale of sales) {
    const dayKey = localDateKey(sale.createdAt);
    const entry =
      perDay.get(dayKey) ?? { salesCount: 0, totalRevenue: 0, totalProfit: 0 };
    entry.salesCount += 1;
    entry.totalRevenue += Number(sale.total);
    entry.totalProfit += Number(sale.profit);
    perDay.set(dayKey, entry);
  }

  return Array.from(perDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, v]) => ({
      month: dayKey,
      totalRevenue: v.totalRevenue,
      totalProfit: v.totalProfit,
      profitMargin:
        v.totalRevenue > 0 ? (v.totalProfit / v.totalRevenue) * 100 : 0,
      salesCount: v.salesCount,
    }));
}

export async function productsReport(storeId: string) {
  const saleItems = await prisma.saleItem.findMany({
    where: { sale: { storeId, status: 'COMPLETED' } },
    include: { product: { include: { category: true } } },
  });

  const perProduct = new Map<string, {
    productId: string;
    name: string;
    category: string | null;
    quantity: number;
    revenue: number;
    profit: number;
  }>();

  for (const item of saleItems) {
    const entry = perProduct.get(item.productId) ?? {
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

  const products = Array.from(perProduct.values())
    .map((p) => ({
      productId: p.productId,
      productName: p.name,
      quantitySold: p.quantity,
      revenue: p.revenue,
      profit: p.profit,
      profitMargin: p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return products;
}

export async function profitMarginByCategory(storeId: string) {
  await validateStore(storeId);

  const saleItems = await prisma.saleItem.findMany({
    where: { sale: { storeId, status: 'COMPLETED' } },
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

  const perSupplier = new Map<string, { supplierId: string; name: string; count: number; total: number }>();

  for (const t of transactions) {
    const entry = perSupplier.get(t.supplierId) ?? {
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
