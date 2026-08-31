import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import {
  mexicoStartOfDay,
  mexicoEndOfDay,
  mexicoLocalDateKey,
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
      createdAt: { gte: mexicoStartOfDay(date), lte: mexicoEndOfDay(date) },
    },
    select: { id: true, total: true, profit: true, paymentMethod: true, createdAt: true },
  });

  const totalSales = sales.reduce((sum, s) => sum + Number(s.total), 0);
  const totalProfitBruta = sales.reduce((sum, s) => sum + Number(s.profit), 0);
  const count = sales.length;

  const adj = await partialSaleCancellationAdjustment(
    storeId,
    mexicoStartOfDay(date),
    mexicoEndOfDay(date)
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
    date: mexicoStartOfDay(date).toISOString().slice(0, 10),
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
    const now = new Date();
    year = now.getFullYear();
    monthIdx = now.getMonth();
  }

  const firstKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const lastKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const sales = await prisma.sale.findMany({
    where: {
      storeId,
      status: 'COMPLETED',
      createdAt: { gte: mexicoStartOfDay(firstKey), lte: mexicoEndOfDay(lastKey) },
    },
    select: { createdAt: true, total: true, profit: true },
  });

  const perDay = new Map<
    string,
    { salesCount: number; totalRevenue: number; totalProfit: number }
  >();
  for (const sale of sales) {
    const dayKey = mexicoLocalDateKey(sale.createdAt);
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
      createdAt: { gte: mexicoStartOfDay(firstKey), lte: mexicoEndOfDay(lastKey) },
    },
    select: { createdAt: true, total: true, items: { select: { profit: true } } },
  });
  for (const c of cancelacionesParciales) {
    const dayKey = mexicoLocalDateKey(c.createdAt);
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

  const storeCfg = await prisma.store.findUnique({
    where: { id: storeId },
    select: { controlCajas: true },
  });
  const controlCajas = storeCfg?.controlCajas ?? false;

  // Cuando la tienda usa control de cajas, incluimos el detalle de las sesiones
  // (lo mismo que el reporte de cierre de caja) para que el corte sea completo,
  // imprimible y exportable.
  let cajas: Awaited<ReturnType<typeof cierreCaja>>["rows"] = [];
  if (controlCajas) {
    const cierreRes = await cierreCaja(storeId, {
      startDate: startDate ?? date,
      endDate: endDate ?? date,
    });
    cajas =     cierreRes.rows;
  }

  // Agregados per-method del período (solo sesiones cerradas).
  const totalExpectedByMethod: Record<string, number> = { CASH: 0, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 };
  const totalClosingByMethod: Record<string, number> = { CASH: 0, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 };
  const totalDiffByMethod: Record<string, number> = { CASH: 0, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 };
  for (const r of cajas) {
    const eb = r.expectedByMethod ?? {};
    const cb = r.closingByMethod ?? {};
    const db = r.diffByMethod ?? {};
    for (const m of Object.keys(totalExpectedByMethod)) {
      totalExpectedByMethod[m] += eb[m] ?? 0;
      totalClosingByMethod[m] += cb[m] ?? 0;
      totalDiffByMethod[m] += db[m] ?? 0;
    }
  }
  const expectedByMethod = totalExpectedByMethod;
  const closingByMethod = totalClosingByMethod;
  const diffByMethod = totalDiffByMethod;
  const movimientosPorMotivo = cajas.flatMap((r) => r.movimientosPorMotivo ?? []);

  // Anclar a día de México: el rango [desde, hasta] cubre el día calendario
  // completo de México sin importar la zona horaria del servidor.
  const desde = startDate ? mexicoStartOfDay(startDate) : mexicoStartOfDay(date);
  const hasta = endDate ? mexicoEndOfDay(endDate) : mexicoEndOfDay(date);

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

  // Cuando la tienda usa control de cajas, el "Efectivo esperado en caja"
  // debe reflejar el dinero real del cajón, no solo lo vendido:
  //   apertura + ventas en efectivo netas + ingresos de caja
  //   - egresos de caja - compras pagadas de caja.
  let aperturaEfectivo = 0;
  let aperturaElectronico = 0;
  let movimientosEfectivoIngreso = 0;
  let movimientosEfectivoEgreso = 0;
  let comprasCajaEfectivo = 0;

  let cashExpected: number;
  if (controlCajas) {
    const openingDateDesde = startDate ?? date ?? '';
    const openingDateHasta = endDate ?? date ?? '';

    const sesiones = await prisma.cajaSession.findMany({
      where: {
        storeId,
        openingDate: { gte: openingDateDesde, lte: openingDateHasta },
        ...(operatorId ? { userId: operatorId } : {}),
      },
      select: { openingCash: true, openingElectronic: true },
    });
    for (const s of sesiones) {
      aperturaEfectivo += Number(s.openingCash);
      aperturaElectronico += Number(s.openingElectronic);
    }

    const movimientos = await prisma.cajaMovimiento.findMany({
      where: {
        storeId,
        createdAt: { gte: desde, lte: hasta },
        ...(operatorId ? { userId: operatorId } : {}),
      },
      select: { tipo: true, metodo: true, monto: true },
    });
    for (const m of movimientos) {
      if (m.metodo !== 'CASH') continue;
      if (m.tipo === 'INGRESO') movimientosEfectivoIngreso += Number(m.monto);
      else if (m.tipo === 'EGRESO') movimientosEfectivoEgreso += Number(m.monto);
    }

    const compras = await prisma.supplierTransaction.findMany({
      where: {
        storeId,
        paidFrom: 'CAJA',
        paymentMethod: 'CASH',
        canceledAt: null,
        createdAt: { gte: desde, lte: hasta },
        ...(operatorId ? { userId: operatorId } : {}),
      },
      select: { total: true },
    });
    for (const c of compras) comprasCajaEfectivo += Number(c.total);

    const ventasEfectivoNet = salesByPayment['CASH']?.total ?? 0;
    cashExpected = Math.max(
      0,
      aperturaEfectivo +
        ventasEfectivoNet +
        movimientosEfectivoIngreso -
        movimientosEfectivoEgreso -
        comprasCajaEfectivo
    );
  } else {
    cashExpected = cashExpectedNeto;
  }

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

  const fechaRef = startDate ?? date ?? mexicoLocalDateKey(new Date());

  const esDiaUnico = mexicoLocalDateKey(desde) === mexicoLocalDateKey(hasta);

  const byHour: { hour: number; count: number; totalRevenue: number }[] = [];
  const byDay: { date: string; count: number; totalRevenue: number }[] = [];

  if (esDiaUnico) {
    const porHora = new Map<number, { count: number; total: number }>();
    for (const s of sales) {
      const hora = s.createdAt.getHours();
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
      const dk = mexicoLocalDateKey(s.createdAt);
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
    controlCajas,
    aperturaEfectivo,
    aperturaElectronico,
    movimientosEfectivoIngreso,
    movimientosEfectivoEgreso,
    comprasCajaEfectivo,
    cajas,
    salesByPayment,
    byHour,
    byDay,
    sales: ventasDetalle,
    cancelledSales: [],
    cancelledAmount,
    partialCancelledCount,
    cancellations,
    inventario,
    totalExpectedByMethod,
    totalClosingByMethod,
    totalDiffByMethod,
    expectedByMethod,
    closingByMethod,
    diffByMethod,
    movimientosPorMotivo,
  };
}

export async function productsReport(storeId: string) {
  const saleItems = await prisma.saleItem.findMany({
    where: { sale: { storeId, status: 'COMPLETED' }, canceledAt: null },
    select: {
      productId: true,
      unitPrice: true,
      quantity: true,
      profit: true,
      product: { select: { name: true, category: { select: { name: true } } } },
    },
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
    select: {
      productId: true,
      unitPrice: true,
      quantity: true,
      profit: true,
      product: { select: { name: true, category: { select: { name: true } } } },
    },
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
    select: { id: true, supplierId: true, total: true, supplier: { select: { id: true, name: true } } },
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

// Reporte de cierres de caja: una fila por sesión (una por caja/día), con
// filtros por caja, cajero (usuario) y rango de fechas, ordenado por día.
export interface CierreCajaFila {
  id: string;
  cajaId: string;
  caja: string;
  userId: string;
  cajero: string;
  status: string;
  openingDate: string | null;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  openingElectronic: number;
  salesCash: number | null;
  salesElectronic: number | null;
  purchasesCash: number | null;
  purchasesElectronic: number | null;
  ingresoCash: number;
  egresoCash: number;
  ingresoElectronic: number;
  egresoElectronic: number;
  expectedCash: number | null;
  expectedElectronic: number | null;
  closingCash: number | null;
  closingElectronic: number | null;
  diffCash: number | null;
  diffElectronic: number | null;
  reopenReason: string | null;
  // Per-method fields (from closingAmounts/expectedAmounts/diffByMethod JSON)
  closingByMethod: Record<string, number> | null;
  expectedByMethod: Record<string, number> | null;
  diffByMethod: Record<string, number> | null;
  // Desglose de movimientos por motivo para el reporte
  movimientosPorMotivo: {
    motivoName: string;
    tipo: 'INGRESO' | 'EGRESO';
    metodo: string;
    total: number;
    cantidad: number;
  }[];
}

export interface CierreCajaFiltros {
  cajaId?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

export async function cierreCaja(
  storeId: string,
  filtros: CierreCajaFiltros = {}
): Promise<{ rows: CierreCajaFila[] }> {
  const where: Prisma.CajaSessionWhereInput = { storeId };
  if (filtros.cajaId) where.cajaId = filtros.cajaId;
  if (filtros.userId) where.userId = filtros.userId;

  // Filtra por el timestamp openedAt usando el día de México completo (desde
  // la medianoche hasta el último milisegundo del día), de modo que una sesión
  // abierta cualquier hora de "fin" quede incluida sin tener que sumar un día.
  if (filtros.startDate || filtros.endDate) {
    const openedAt: Prisma.DateTimeFilter = {};
    if (filtros.startDate) openedAt.gte = mexicoStartOfDay(filtros.startDate);
    if (filtros.endDate) openedAt.lte = mexicoEndOfDay(filtros.endDate);
    where.openedAt = openedAt;
  }

  const sessions = await prisma.cajaSession.findMany({
    where,
    include: {
      caja: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: [{ openingDate: 'asc' }, { openedAt: 'asc' }],
  });

  const sessionIds = sessions.map((s) => s.id);
  const movGroups = sessionIds.length
    ? await prisma.cajaMovimiento.groupBy({
        by: ['cajaSessionId', 'tipo', 'metodo'],
        where: { cajaSessionId: { in: sessionIds }, storeId },
        _sum: { monto: true },
      })
    : [];

  const movMap = new Map<
    string,
    { ingresoCash: number; egresoCash: number; ingresoElectronic: number; egresoElectronic: number }
  >();
  for (const g of movGroups) {
    const id = g.cajaSessionId;
    const entry = movMap.get(id) ?? {
      ingresoCash: 0,
      egresoCash: 0,
      ingresoElectronic: 0,
      egresoElectronic: 0,
    };
    const monto = Number(g._sum.monto ?? 0);
    if (g.tipo === 'INGRESO') {
      if (g.metodo === 'CASH') entry.ingresoCash += monto;
      else entry.ingresoElectronic += monto;
    } else {
      if (g.metodo === 'CASH') entry.egresoCash += monto;
      else entry.egresoElectronic += monto;
    }
    movMap.set(id, entry);
  }

  const rows: CierreCajaFila[] = await Promise.all(sessions.map(async (s) => {
    const mov = movMap.get(s.id) ?? {
      ingresoCash: 0,
      egresoCash: 0,
      ingresoElectronic: 0,
      egresoElectronic: 0,
    };
    // Movimientos agrupados por motivo (incluye nombre del motivo).
    const movs = await prisma.cajaMovimiento.findMany({
      where: { cajaSessionId: s.id, storeId },
      select: {
        tipo: true,
        metodo: true,
        monto: true,
        motivoId: true,
        motivoTexto: true,
        motivo: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const grupos = new Map<string, { motivoName: string; tipo: 'INGRESO'|'EGRESO'; metodo: string; total: number; cantidad: number }>();
    for (const m of movs) {
      const motivoName = m.motivo?.name ?? (m.motivoTexto ? 'Otro (texto libre)' : 'Sin motivo');
      const key = `${m.tipo}|${m.metodo}|${m.motivoId ?? ''}|${m.motivoTexto ?? ''}|${motivoName}`;
      const ex = grupos.get(key);
      if (ex) {
        ex.total += Number(m.monto);
        ex.cantidad += 1;
      } else {
        grupos.set(key, {
          motivoName,
          tipo: m.tipo as 'INGRESO'|'EGRESO',
          metodo: m.metodo,
          total: Number(m.monto),
          cantidad: 1,
        });
      }
    }

    return {
      id: s.id,
      cajaId: s.cajaId,
      caja: s.caja?.name ?? 'Caja',
      userId: s.userId,
      cajero: s.user?.name ?? '—',
      status: s.status,
      openingDate: s.openingDate,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt ? s.closedAt.toISOString() : null,
      openingCash: Number(s.openingCash),
      openingElectronic: Number(s.openingElectronic),
      salesCash: s.salesCash != null ? Number(s.salesCash) : null,
      salesElectronic: s.salesElectronic != null ? Number(s.salesElectronic) : null,
      purchasesCash: s.purchasesCash != null ? Number(s.purchasesCash) : null,
      purchasesElectronic: s.purchasesElectronic != null ? Number(s.purchasesElectronic) : null,
      ingresoCash: mov.ingresoCash,
      egresoCash: mov.egresoCash,
      ingresoElectronic: mov.ingresoElectronic,
      egresoElectronic: mov.egresoElectronic,
      expectedCash: s.expectedCash != null ? Number(s.expectedCash) : null,
      expectedElectronic: s.expectedElectronic != null ? Number(s.expectedElectronic) : null,
      closingCash: s.closingCash != null ? Number(s.closingCash) : null,
      closingElectronic: s.closingElectronic != null ? Number(s.closingElectronic) : null,
      diffCash: s.diffCash != null ? Number(s.diffCash) : null,
      diffElectronic: s.diffElectronic != null ? Number(s.diffElectronic) : null,
      reopenReason: s.reopenReason ?? null,
      closingByMethod: (s.closingAmounts as Record<string, number> | null) ?? null,
      expectedByMethod: (s.expectedAmounts as Record<string, number> | null) ?? null,
      diffByMethod: (s.diffByMethod as Record<string, number> | null) ?? null,
      movimientosPorMotivo: Array.from(grupos.values()),
    };
  }));

  return { rows };
}
