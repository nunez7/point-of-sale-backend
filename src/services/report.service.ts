import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { parseLocalDate } from '../utils/dates';

function startOfDay(dateStr?: string): Date {
  const base = dateStr ? parseLocalDate(dateStr) : new Date();
  base.setHours(0, 0, 0, 0);
  return base;
}

function endOfDay(dateStr?: string): Date {
  const base = dateStr ? parseLocalDate(dateStr) : new Date();
  base.setHours(23, 59, 59, 999);
  return base;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
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
  };

  return result;
}

export async function corteCaja(storeId: string, date?: string, operatorId?: string) {
  await validateStore(storeId);

  const desde = startOfDay(date);
  const hasta = endOfDay(date);

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
    include: { items: { include: { product: { include: { category: true } } } } },
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

  // Group by hour
  const byHour = new Map<number, { count: number; totalRevenue: number }>();
  for (const sale of sales) {
    const hour = sale.createdAt.getHours();
    const entry = byHour.get(hour) ?? { count: 0, totalRevenue: 0 };
    entry.count += 1;
    entry.totalRevenue += Number(sale.total);
    byHour.set(hour, entry);
  }

  const salesByPayment: Record<string, { count: number; total: number }> = {};
  for (const [method, v] of byPayment.entries()) {
    salesByPayment[method] = { count: v.count, total: Number(v.total) };
  }

  const revenue = Number(totalRevenue);
  const count = sales.length;

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
        totalRevenue: Number(v.totalRevenue),
      })),
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
