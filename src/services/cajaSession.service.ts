import { prisma } from '../config/prisma';
import { Prisma, Role, PaymentMethod } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { mexicoStartOfDay, mexicoLocalDateKey } from '../utils/dates';
import { registerOpening } from './stockMovement.service';
import { resumenMovimientos } from './cajaMovimiento.service';

// Métodos de pago que cuentan como "electrónico" en el corte de caja.
const ELECTRONIC_METHODS: PaymentMethod[] = [
  PaymentMethod.CARD,
  PaymentMethod.TRANSFER,
  PaymentMethod.CREDIT,
  PaymentMethod.OTHER,
];

function isElectronic(method: PaymentMethod): boolean {
  return ELECTRONIC_METHODS.includes(method);
}

export interface OpenCajaInput {
  openingCash: number;
  openingElectronic: number;
  openingNote?: string | null;
}

export interface CloseCajaInput {
  closingCash: number;
  closingElectronic: number;
  closingNote?: string | null;
}

const sessionInclude = {
  caja: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CajaSessionInclude;

// Abre una caja: crea una sesión OPEN. La misma caja no puede tener dos
// sesiones abiertas. Si la tienda usa inventario en la apertura, captura el
// snapshot del día automáticamente.
export async function openCaja(
  storeId: string,
  userId: string,
  role: string,
  cajaId: string,
  data: OpenCajaInput
) {
  const caja = await prisma.caja.findFirst({ where: { id: cajaId, storeId } });
  if (!caja) throw ApiError.notFound('Caja no encontrada', 'CAJA_NOT_FOUND');
  if (!caja.isActive) {
    throw ApiError.badRequest('La caja está inactiva', 'CAJA_INACTIVE');
  }

  // Solo un administrador o gerente puede abrir una caja; el cajero (vendedor)
  // opera la sesión que un administrador/gerente haya abierto.
  if (role === Role.VENDEDOR) {
    throw ApiError.forbidden(
      'Solo un administrador o gerente puede abrir la caja',
      'CAJA_OPEN_FORBIDDEN'
    );
  }

  const existing = await prisma.cajaSession.findFirst({
    where: { cajaId, storeId, status: 'OPEN' },
  });
  if (existing) {
    throw ApiError.badRequest(
      'Esta caja ya tiene una sesión abierta',
      'CAJA_YA_ABIERTA'
    );
  }

  // Debe registrar fondo de apertura en al menos un medio de pago.
  if ((data.openingCash ?? 0) <= 0 && (data.openingElectronic ?? 0) <= 0) {
    throw ApiError.badRequest(
      'Debe registrar dinero de apertura (efectivo o electrónico) para abrir la caja',
      'CAJA_APERTURA_SIN_FONDOS'
    );
  }

  // Una misma caja solo puede tener una sesión por día. Si ya existe una sesión
  // (abierta o cerrada) para el día de hoy, no se crea una nueva: para volver a
  // operar la caja del día debe reabrirse desde el menú Cajas (ADMIN/GERENTE).
  const ahora = new Date();
  const hoyStr = mexicoLocalDateKey(ahora);
  const inicioHoy = mexicoStartOfDay(hoyStr);
  const finHoy = new Date(ahora.getTime() + 24 * 60 * 60 * 1000 - 1);
  const sesionHoy = await prisma.cajaSession.findFirst({
    where: {
      cajaId,
      storeId,
      status: 'OPEN',
      openedAt: {
        gte: inicioHoy,
        lte: finHoy,
      },
    },
  });
  if (sesionHoy) {
    throw ApiError.badRequest(
      'Esta caja ya tiene una sesión registrada hoy. Para reabrirla usa el menú Cajas (ADMIN/GERENTE).',
      'CAJA_YA_TIENE_SESION_HOY'
    );
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { aperturaCajaConInventario: true },
  });
  const adjustInventory = store?.aperturaCajaConInventario ?? false;
  if (adjustInventory) {
    await registerOpening(storeId);
  }

  const openedAt = new Date();
  const session = await prisma.cajaSession.create({
    data: {
      storeId,
      cajaId,
      userId,
      openedAt,
      openingDate: mexicoLocalDateKey(openedAt),
      openingCash: new Prisma.Decimal(data.openingCash),
      openingElectronic: new Prisma.Decimal(data.openingElectronic),
      openingNote: data.openingNote ?? null,
      inventoryAdjusted: adjustInventory,
      status: 'OPEN',
    },
    include: sessionInclude,
  });

  await audit({
    storeId,
    userId,
    action: 'OPEN_CAJA',
    entity: 'CajaSession',
    entityId: session.id,
    metadata: { cajaId, openingCash: data.openingCash, openingElectronic: data.openingElectronic },
  });

  return session;
}

// Calcula el corte de una sesión (efectivo/electrónico) sumando las ventas del
// turno por método de pago y restando las compras pagadas con dinero de caja.
// Se comparte entre el cierre y la previsualización del corte.
export async function calcularCorte(
  session: { id: string; openingCash: Prisma.Decimal | number; openingElectronic: Prisma.Decimal | number },
  storeId: string
) {
  const saleGroups = await prisma.sale.groupBy({
    by: ['paymentMethod'],
    where: { cajaSessionId: session.id, storeId, status: 'COMPLETED' },
    _sum: { total: true },
  });
  const purchaseGroups = await prisma.supplierTransaction.groupBy({
    by: ['paymentMethod'],
    where: { cajaSessionId: session.id, storeId, status: 'COMPLETED', paidFrom: 'CAJA' },
    _sum: { total: true },
  });

  let salesCash = new Prisma.Decimal(0);
  let salesElectronic = new Prisma.Decimal(0);
  for (const g of saleGroups) {
    const total = g._sum.total ?? new Prisma.Decimal(0);
    if (isElectronic(g.paymentMethod as PaymentMethod)) salesElectronic = salesElectronic.plus(total);
    else salesCash = salesCash.plus(total);
  }

  let purchasesCash = new Prisma.Decimal(0);
  let purchasesElectronic = new Prisma.Decimal(0);
  for (const g of purchaseGroups) {
    const total = g._sum.total ?? new Prisma.Decimal(0);
    if (isElectronic(g.paymentMethod as PaymentMethod)) purchasesElectronic = purchasesElectronic.plus(total);
    else purchasesCash = purchasesCash.plus(total);
  }

  const openingCash = new Prisma.Decimal(session.openingCash);
  const openingElectronic = new Prisma.Decimal(session.openingElectronic);

  // Movimientos manuales de caja (ingreso/egreso) registrados en la sesión.
  const mov = await resumenMovimientos(session.id, storeId);
  const ingresoCash = mov.ingresoCash;
  const egresoCash = mov.egresoCash;
  const ingresoElectronic = mov.ingresoElectronic;
  const egresoElectronic = mov.egresoElectronic;

  // Solo las compras pagadas con dinero de caja (paidFrom = "CAJA") descuentan
  // del corte; las pagadas con efectivo de dueño no afectan el corte.
  const expectedCash = openingCash
    .plus(salesCash)
    .minus(purchasesCash)
    .plus(ingresoCash)
    .minus(egresoCash);
  const expectedElectronic = openingElectronic
    .plus(salesElectronic)
    .minus(purchasesElectronic)
    .plus(ingresoElectronic)
    .minus(egresoElectronic);

  return {
    salesCash,
    salesElectronic,
    purchasesCash,
    purchasesElectronic,
    ingresoCash,
    egresoCash,
    ingresoElectronic,
    egresoElectronic,
    expectedCash,
    expectedElectronic,
  };
}

// Previsualiza el corte de una sesión abierta (sin cerrarla) para mostrar los
// montos esperados en el momento del cierre.
export async function previsualizarCorte(sessionId: string, storeId: string) {
  const session = await prisma.cajaSession.findFirst({
    where: { id: sessionId, storeId },
    include: { caja: true },
  });
  if (!session) throw ApiError.notFound('Sesión de caja no encontrada', 'CAJA_SESSION_NOT_FOUND');
  if (session.status === 'CLOSED') {
    throw ApiError.badRequest('La caja ya está cerrada', 'CAJA_YA_CERRADA');
  }
  const cut = await calcularCorte(session, storeId);
  return {
    salesCash: Number(cut.salesCash),
    salesElectronic: Number(cut.salesElectronic),
    purchasesCash: Number(cut.purchasesCash),
    purchasesElectronic: Number(cut.purchasesElectronic),
    expectedCash: Number(cut.expectedCash),
    expectedElectronic: Number(cut.expectedElectronic),
  };
}

// Cierra una caja: calcula el corte (efectivo/electrónico) sumando ventas y
// restando compras del turno, y registra las diferencias declaradas.
export async function closeCaja(
  sessionId: string,
  storeId: string,
  userId: string,
  role: string,
  data: CloseCajaInput
) {
  const session = await prisma.cajaSession.findFirst({
    where: { id: sessionId, storeId },
    include: { caja: true },
  });
  if (!session) throw ApiError.notFound('Sesión de caja no encontrada', 'CAJA_SESSION_NOT_FOUND');
  if (session.status === 'CLOSED') {
    throw ApiError.badRequest('La caja ya está cerrada', 'CAJA_YA_CERRADA');
  }
  if (role === Role.VENDEDOR && session.userId !== userId) {
    throw ApiError.forbidden(
      'Solo el operador que abrió la caja puede cerrarla',
      'CAJA_NOT_OPERATOR'
    );
  }

  const cut = await calcularCorte(session, storeId);

  const salesCash = cut.salesCash;
  const salesElectronic = cut.salesElectronic;
  const purchasesCash = cut.purchasesCash;
  const purchasesElectronic = cut.purchasesElectronic;
  const expectedCash = cut.expectedCash;
  const expectedElectronic = cut.expectedElectronic;

  const closingCash = new Prisma.Decimal(data.closingCash);
  const closingElectronic = new Prisma.Decimal(data.closingElectronic);

  const diffCash = closingCash.minus(expectedCash);
  const diffElectronic = closingElectronic.minus(expectedElectronic);

  const closedAt = new Date();
  const closed = await prisma.cajaSession.update({
    where: { id: session.id },
    data: {
      status: 'CLOSED',
      closedAt,
      closingDate: mexicoLocalDateKey(closedAt),
      closedBy: userId,
      closingCash,
      closingElectronic,
      closingNote: data.closingNote ?? null,
      salesCash,
      salesElectronic,
      purchasesCash,
      purchasesElectronic,
      expectedCash,
      expectedElectronic,
      diffCash,
      diffElectronic,
    },
    include: sessionInclude,
  });

  await audit({
    storeId,
    userId,
    action: 'CLOSE_CAJA',
    entity: 'CajaSession',
    entityId: session.id,
    metadata: {
      cajaId: session.cajaId,
      expectedCash: expectedCash.toString(),
      expectedElectronic: expectedElectronic.toString(),
      diffCash: diffCash.toString(),
      diffElectronic: diffElectronic.toString(),
    },
  });

  return closed;
}

// Reabre una sesión ya cerrada del día (solo ADMIN/GERENTE, con motivo
// obligatorio). El evento queda registrado en AuditLog como histórico.
export async function reopenCaja(
  sessionId: string,
  storeId: string,
  userId: string,
  role: string,
  motivo: string
) {
  if (role === Role.VENDEDOR) {
    throw ApiError.forbidden(
      'Solo un administrador o gerente puede reabrir la caja',
      'CAJA_REOPEN_FORBIDDEN'
    );
  }

  const session = await prisma.cajaSession.findFirst({
    where: { id: sessionId, storeId },
    include: { caja: true },
  });
  if (!session) throw ApiError.notFound('Sesión de caja no encontrada', 'CAJA_SESSION_NOT_FOUND');
  if (session.status !== 'CLOSED') {
    throw ApiError.badRequest('La caja ya está abierta', 'CAJA_YA_ABIERTA');
  }

  const hoy = mexicoLocalDateKey(new Date());
  if (session.openingDate !== hoy) {
    throw ApiError.badRequest(
      'Solo se puede reabrir una sesión cerrada del día de hoy',
      'CAJA_REOPEN_OTRO_DIA'
    );
  }

  const reopened = await prisma.cajaSession.update({
    where: { id: session.id },
    data: {
      status: 'OPEN',
      closedAt: null,
      closingDate: null,
      closedBy: null,
      closingCash: null,
      closingElectronic: null,
      closingNote: null,
      salesCash: null,
      salesElectronic: null,
      purchasesCash: null,
      purchasesElectronic: null,
      expectedCash: null,
      expectedElectronic: null,
      diffCash: null,
      diffElectronic: null,
      reopenedAt: new Date(),
      reopenedBy: userId,
      reopenReason: motivo,
    },
    include: sessionInclude,
  });

  await audit({
    storeId,
    userId,
    action: 'REABRIR_CAJA',
    entity: 'CajaSession',
    entityId: session.id,
    metadata: { cajaId: session.cajaId, motivo },
  });

  return reopened;
}

// Sesión activa (abierta) para un usuario: la de su caja asignada, o la
// sesión abierta donde es el operador.
export async function getActiveSession(storeId: string, userId: string) {
  const caja = await prisma.caja.findFirst({
    where: { assignedUserId: userId, storeId, isActive: true },
    select: { id: true },
  });
  const where: Prisma.CajaSessionWhereInput = { storeId, status: 'OPEN' };
  if (caja) where.cajaId = caja.id;
  else where.userId = userId;

  return prisma.cajaSession.findFirst({
    where,
    include: {
      caja: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { openedAt: 'desc' },
  });
}

export interface SessionFilters {
  cajaId?: string;
  status?: 'OPEN' | 'CLOSED';
  startDate?: string;
  endDate?: string;
}

export async function listSessions(storeId: string, filters: SessionFilters = {}) {
  const where: Prisma.CajaSessionWhereInput = { storeId };
  if (filters.cajaId) where.cajaId = filters.cajaId;
  if (filters.status) where.status = filters.status;

  if (filters.startDate || filters.endDate) {
    const openedAt: Prisma.DateTimeFilter = {};
    if (filters.startDate) openedAt.gte = mexicoStartOfDay(filters.startDate);
    if (filters.endDate) {
      const end = mexicoStartOfDay(filters.endDate);
      end.setHours(23, 59, 59, 999);
      openedAt.lte = end;
    }
    where.openedAt = openedAt;
  }

  const sessions = await prisma.cajaSession.findMany({
    where,
    include: {
      caja: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { openedAt: 'desc' },
  });
  return sessions;
}

// Reporte de corte de la sesión: ventas/compras del turno y reconciliación de
// inventario (inicial del snapshot de apertura vs final actual).
export async function getSessionReport(sessionId: string, storeId: string) {
  const session = await prisma.cajaSession.findFirst({
    where: { id: sessionId, storeId },
    include: {
      caja: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  });
  if (!session) throw ApiError.notFound('Sesión de caja no encontrada', 'CAJA_SESSION_NOT_FOUND');

  const desde = mexicoStartOfDay(mexicoLocalDateKey(session.openedAt));
  const hasta = session.closedAt ?? new Date();

  const sales = await prisma.sale.findMany({
    where: { cajaSessionId: session.id, storeId },
    select: {
      id: true,
      saleNumber: true,
      total: true,
      paymentMethod: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const purchases = await prisma.supplierTransaction.findMany({
    where: { cajaSessionId: session.id, storeId },
    select: {
      id: true,
      reference: true,
      total: true,
      paymentMethod: true,
      paidFrom: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Inventario: inicial (snapshot de apertura o reconstrucción) vs final.
  const inventories = await prisma.inventory.findMany({
    where: { storeId },
    include: { product: { select: { id: true, name: true, unidadVenta: true } } },
  });

  const snapshots = await prisma.inventorySnapshot.findMany({
    where: { storeId, date: desde },
  });
  const snapshotMap = new Map(snapshots.map((s) => [s.productId, s.quantity]));

  const saleItems = await prisma.saleItem.findMany({
    where: { sale: { cajaSessionId: session.id, storeId } },
    select: { productId: true, quantity: true },
  });
  const ventas = new Map<string, Prisma.Decimal>();
  for (const it of saleItems) {
    ventas.set(it.productId, (ventas.get(it.productId) ?? new Prisma.Decimal(0)).plus(it.quantity));
  }

  const movements = await prisma.stockMovement.findMany({
    where: { storeId, status: 'ACTIVE', createdAt: { gte: desde, lte: hasta } },
    select: { productId: true, tipo: true, quantity: true },
  });
  const entradas = new Map<string, Prisma.Decimal>();
  const salidas = new Map<string, Prisma.Decimal>();
  for (const m of movements) {
    const map = m.tipo === 'ENTRADA' ? entradas : salidas;
    map.set(m.productId, (map.get(m.productId) ?? new Prisma.Decimal(0)).plus(m.quantity));
  }

  const inventory = inventories.map((inv) => {
    const venta = ventas.get(inv.productId) ?? new Prisma.Decimal(0);
    const entrada = entradas.get(inv.productId) ?? new Prisma.Decimal(0);
    const salida = salidas.get(inv.productId) ?? new Prisma.Decimal(0);
    const snap = snapshotMap.get(inv.productId);
    const initial =
      snap !== undefined
        ? snap
        : new Prisma.Decimal(inv.quantity).plus(venta).plus(salida).minus(entrada);
    return {
      productId: inv.productId,
      productName: inv.product.name,
      unidadVenta: inv.product.unidadVenta,
      initial: Number(initial),
      ventas: Number(venta),
      entradas: Number(entrada),
      salidas: Number(salida),
      final: Number(inv.quantity),
    };
  });

  return {
    session,
    sales: sales.map((s) => ({ ...s, total: Number(s.total) })),
    purchases: purchases.map((p) => ({ ...p, total: Number(p.total) })),
    inventory,
    inventoryAdjusted: session.inventoryAdjusted ?? false,
  };
}
