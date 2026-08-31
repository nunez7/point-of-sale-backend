import { prisma } from '../config/prisma';
import { Prisma, Role, PaymentMethod } from '../../generated/prisma/client.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { mexicoStartOfDay, mexicoLocalDateKey } from '../utils/dates';
import { registerOpening } from './stockMovement.service';
import { resumenMovimientos, resumenMovimientosPorMetodo, resumenPorMotivo } from './cajaMovimiento.service';

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
  authorizationToken?: string;
}

export interface CloseCajaInput {
  closingAmounts: Record<PaymentMethod, number>;
  closingNote?: string | null;
  authorizationToken?: string;
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

  // El vendedor solo puede abrir caja con autorización válida de ADMIN/GERENTE.
  // Administradores y gerentes pueden abrir sin token.
  if (role === Role.VENDEDOR) {
    if (!data.authorizationToken) {
      throw ApiError.forbidden(
        'Se requiere autorización de un administrador o gerente para abrir la caja',
        'OPEN_CAJA_AUTHORIZATION_REQUIRED'
      );
    }
    try {
      const authorization = jwt.verify(data.authorizationToken, env.JWT_SECRET) as {
        storeId?: string;
        role?: string;
        purpose?: string;
      };
      if (
        authorization.storeId !== storeId ||
        (authorization.role !== Role.ADMIN && authorization.role !== Role.GERENTE) ||
        authorization.purpose !== 'OPEN_CAJA'
      ) {
        throw new Error('Autorización inválida');
      }
    } catch {
      throw ApiError.forbidden(
        'La autorización de apertura no es válida o ya expiró',
        'OPEN_CAJA_AUTHORIZATION_INVALID'
      );
    }
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
  const sesionHoy = await prisma.cajaSession.findFirst({
    where: {
      cajaId,
      storeId,
      openingDate: mexicoLocalDateKey(new Date()),
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

// Calcula el corte de una sesión por método de pago (CASH, CARD, TRANSFER,
// CREDIT, OTHER). Suma las ventas del turno, resta las compras pagadas con
// dinero de caja, y suma/resta los movimientos manuales de caja. Devuelve
// también los agregados efectivo/electrónico para mantener compatibilidad con
// los usos existentes.
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

  // Initialize per-method buckets with zero for all PaymentMethod values.
  const salesByMethod: Record<PaymentMethod, Prisma.Decimal> = {
    CASH: new Prisma.Decimal(0),
    CARD: new Prisma.Decimal(0),
    TRANSFER: new Prisma.Decimal(0),
    CREDIT: new Prisma.Decimal(0),
    OTHER: new Prisma.Decimal(0),
  };
  const purchasesByMethod: Record<PaymentMethod, Prisma.Decimal> = {
    CASH: new Prisma.Decimal(0),
    CARD: new Prisma.Decimal(0),
    TRANSFER: new Prisma.Decimal(0),
    CREDIT: new Prisma.Decimal(0),
    OTHER: new Prisma.Decimal(0),
  };

  for (const g of saleGroups) {
    const m = g.paymentMethod as PaymentMethod;
    const total = g._sum.total ?? new Prisma.Decimal(0);
    if (salesByMethod[m] !== undefined) salesByMethod[m] = salesByMethod[m].plus(total);
  }

  for (const g of purchaseGroups) {
    const m = g.paymentMethod as PaymentMethod;
    const total = g._sum.total ?? new Prisma.Decimal(0);
    if (purchasesByMethod[m] !== undefined) purchasesByMethod[m] = purchasesByMethod[m].plus(total);
  }

  let salesCash = new Prisma.Decimal(0);
  let salesElectronic = new Prisma.Decimal(0);
  for (const m of Object.values(PaymentMethod)) {
    if (isElectronic(m)) salesElectronic = salesElectronic.plus(salesByMethod[m]);
    else salesCash = salesCash.plus(salesByMethod[m]);
  }

  let purchasesCash = new Prisma.Decimal(0);
  let purchasesElectronic = new Prisma.Decimal(0);
  for (const m of Object.values(PaymentMethod)) {
    if (isElectronic(m)) purchasesElectronic = purchasesElectronic.plus(purchasesByMethod[m]);
    else purchasesCash = purchasesCash.plus(purchasesByMethod[m]);
  }

  // Movimientos manuales de caja: a partir de ahora también se desglosan por
  // método real (CARD, TRANSFER, etc.) en lugar de agruparse en ELECTRONIC.
  const movByMethod = await resumenMovimientosPorMetodo(session.id, storeId);

  // Apertura: la declaración histórica separa efectivo vs. electrónico. Para
  // mantener compatibilidad con el formato per-method, todo el efectivo de
  // apertura va al bucket CASH y el resto (no usado en la práctica) a OTHER.
  const openingCash = new Prisma.Decimal(session.openingCash);
  const openingElectronic = new Prisma.Decimal(session.openingElectronic);

  const openingByMethod: Record<PaymentMethod, Prisma.Decimal> = {
    CASH: openingCash,
    CARD: new Prisma.Decimal(0),
    TRANSFER: new Prisma.Decimal(0),
    CREDIT: new Prisma.Decimal(0),
    OTHER: openingElectronic,
  };

  // Compras a proveedor pagadas con dinero de caja. Solo las que tienen
  // paidFrom=CAJA afectan al corte (las del dueño no).
  // expectedByMethod[m] = openingByMethod[m] + salesByMethod[m]
  //                       - purchasesByMethod[m]
  //                       + movimientosIngresoByMethod[m]
  //                       - movimientosEgresoByMethod[m]
  const expectedByMethod: Record<PaymentMethod, Prisma.Decimal> = {
    CASH: new Prisma.Decimal(0),
    CARD: new Prisma.Decimal(0),
    TRANSFER: new Prisma.Decimal(0),
    CREDIT: new Prisma.Decimal(0),
    OTHER: new Prisma.Decimal(0),
  };
  for (const m of Object.values(PaymentMethod)) {
    expectedByMethod[m] = openingByMethod[m]
      .plus(salesByMethod[m])
      .minus(purchasesByMethod[m])
      .plus(movByMethod.ingreso[m])
      .minus(movByMethod.egreso[m]);
  }

  // Legacy aggregates (cash + electronic).
  const ingresoCash = movByMethod.ingreso.CASH;
  const egresoCash = movByMethod.egreso.CASH;
  const ingresoElectronic = (['CARD', 'TRANSFER', 'CREDIT', 'OTHER'] as PaymentMethod[]).reduce(
    (acc, m) => acc.plus(movByMethod.ingreso[m]),
    new Prisma.Decimal(0)
  );
  const egresoElectronic = (['CARD', 'TRANSFER', 'CREDIT', 'OTHER'] as PaymentMethod[]).reduce(
    (acc, m) => acc.plus(movByMethod.egreso[m]),
    new Prisma.Decimal(0)
  );

  const expectedCash = expectedByMethod.CASH;
  const expectedElectronic = (['CARD', 'TRANSFER', 'CREDIT', 'OTHER'] as PaymentMethod[]).reduce(
    (acc, m) => acc.plus(expectedByMethod[m]),
    new Prisma.Decimal(0)
  );

  // Serializa a number para enviar al frontend.
  const num = (d: Prisma.Decimal) => Number(d);
  const recordNums = (r: Record<PaymentMethod, Prisma.Decimal>): Record<PaymentMethod, number> => {
    const out: Partial<Record<PaymentMethod, number>> = {};
    for (const m of Object.values(PaymentMethod)) out[m] = num(r[m]);
    return out as Record<PaymentMethod, number>;
  };

  return {
    salesByMethod: recordNums(salesByMethod),
    purchasesByMethod: recordNums(purchasesByMethod),
    openingByMethod: recordNums(openingByMethod),
    expectedByMethod: recordNums(expectedByMethod),
    movimientosIngresoByMethod: recordNums(movByMethod.ingreso),
    movimientosEgresoByMethod: recordNums(movByMethod.egreso),
    // Legacy
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
    salesByMethod: cut.salesByMethod,
    purchasesByMethod: cut.purchasesByMethod,
    openingByMethod: cut.openingByMethod,
    expectedByMethod: cut.expectedByMethod,
    movimientosIngresoByMethod: cut.movimientosIngresoByMethod,
    movimientosEgresoByMethod: cut.movimientosEgresoByMethod,
    // Legacy
    salesCash: Number(cut.salesCash),
    salesElectronic: Number(cut.salesElectronic),
    purchasesCash: Number(cut.purchasesCash),
    purchasesElectronic: Number(cut.purchasesElectronic),
    ingresoCash: Number(cut.ingresoCash),
    egresoCash: Number(cut.egresoCash),
    ingresoElectronic: Number(cut.ingresoElectronic),
    egresoElectronic: Number(cut.egresoElectronic),
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
  if (role === Role.VENDEDOR) {
    if (!data.authorizationToken) {
      throw ApiError.forbidden(
        'Se requiere autorización de un administrador o gerente',
        'CLOSE_CAJA_AUTHORIZATION_REQUIRED'
      );
    }
    try {
      const authorization = jwt.verify(data.authorizationToken, env.JWT_SECRET) as {
        storeId?: string;
        role?: string;
        purpose?: string;
      };
      if (
        authorization.storeId !== storeId ||
        (authorization.role !== Role.ADMIN && authorization.role !== Role.GERENTE) ||
        authorization.purpose !== 'CLOSE_CAJA'
      ) {
        throw new Error('Autorización inválida');
      }
    } catch {
      throw ApiError.forbidden(
        'La autorización de cierre no es válida o ya expiró',
        'CLOSE_CAJA_AUTHORIZATION_INVALID'
      );
    }
  }
  const cut = await calcularCorte(session, storeId);

  const salesCash = cut.salesCash;
  const salesElectronic = cut.salesElectronic;
  const purchasesCash = cut.purchasesCash;
  const purchasesElectronic = cut.purchasesElectronic;
  const expectedCash = cut.expectedCash;
  const expectedElectronic = cut.expectedElectronic;

  // Normaliza los montos de cierre enviados por el frontend a un record
  // completo con todos los métodos. Métodos no enviados = 0.
  const normalizeAmounts = (
    input: Record<string, number | undefined> | null | undefined
  ): Record<PaymentMethod, Prisma.Decimal> => {
    const out: Partial<Record<PaymentMethod, Prisma.Decimal>> = {};
    for (const m of Object.values(PaymentMethod)) {
      const v = input?.[m];
      const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
      out[m] = new Prisma.Decimal(n);
    }
    return out as Record<PaymentMethod, Prisma.Decimal>;
  };

  const closingByMethod = normalizeAmounts(data.closingAmounts);
  const expectedByMethod: Record<PaymentMethod, Prisma.Decimal> = {
    CASH: new Prisma.Decimal(0),
    CARD: new Prisma.Decimal(0),
    TRANSFER: new Prisma.Decimal(0),
    CREDIT: new Prisma.Decimal(0),
    OTHER: new Prisma.Decimal(0),
  };
  for (const m of Object.values(PaymentMethod)) {
    expectedByMethod[m] = new Prisma.Decimal(cut.expectedByMethod[m] ?? 0);
  }
  const diffByMethod: Record<PaymentMethod, Prisma.Decimal> = {
    CASH: new Prisma.Decimal(0),
    CARD: new Prisma.Decimal(0),
    TRANSFER: new Prisma.Decimal(0),
    CREDIT: new Prisma.Decimal(0),
    OTHER: new Prisma.Decimal(0),
  };
  for (const m of Object.values(PaymentMethod)) {
    diffByMethod[m] = closingByMethod[m].minus(expectedByMethod[m]);
  }

  // Legacy aggregates para mantener compatibilidad con pantallas existentes.
  const closingCash = closingByMethod.CASH;
  const closingElectronic = (['CARD', 'TRANSFER', 'CREDIT', 'OTHER'] as PaymentMethod[]).reduce(
    (acc, m) => acc.plus(closingByMethod[m]),
    new Prisma.Decimal(0)
  );
  const diffCash = closingCash.minus(expectedCash);
  const diffElectronic = closingElectronic.minus(expectedElectronic);

  // Serializa los records a JSON-serializable (number).
  const toJson = (r: Record<PaymentMethod, Prisma.Decimal>): Record<PaymentMethod, number> => {
    const out: Partial<Record<PaymentMethod, number>> = {};
    for (const m of Object.values(PaymentMethod)) out[m] = Number(r[m]);
    return out as Record<PaymentMethod, number>;
  };

  const closedAt = new Date();
  const closed = await prisma.cajaSession.update({
    where: { id: session.id },
    data: {
      status: 'CLOSED',
      closedAt,
      // El cierre pertenece al día del turno (día en que se abrió la caja),
      // no al instante calendario del cierre (un turno nocturno que cruza la
      // medianoche se reporta bajo su apertura).
      closingDate: session.openingDate,
      closedBy: userId,
      closingCash,
      closingElectronic,
      closingNote: data.closingNote ?? null,
      closingAmounts: toJson(closingByMethod) as unknown as Prisma.InputJsonValue,
      expectedAmounts: toJson(expectedByMethod) as unknown as Prisma.InputJsonValue,
      diffByMethod: toJson(diffByMethod) as unknown as Prisma.InputJsonValue,
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
      closingByMethod: toJson(closingByMethod),
      expectedByMethod: toJson(expectedByMethod),
      diffByMethod: toJson(diffByMethod),
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
      closingAmounts: Prisma.JsonNull,
      expectedAmounts: Prisma.JsonNull,
      diffByMethod: Prisma.JsonNull,
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
    // El día de negocio es el día en que se abrió el turno (openingDate), igual
    // que en el reporte de corte: las sesiones se agrupan por su apertura.
    const openingDate: Prisma.StringFilter = {};
    if (filters.startDate) openingDate.gte = filters.startDate;
    if (filters.endDate) openingDate.lte = filters.endDate;
    where.openingDate = openingDate;
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

  const mov = await resumenMovimientos(session.id, storeId);
  const cut = await calcularCorte(session, storeId);

  const movPorMotivo = await resumenPorMotivo(session.id, storeId);

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

  // Deserializa los JSON de cierre (pueden ser null en sesiones abiertas/reabiertas).
  const parseJson = <T>(v: unknown): T | null => {
    if (v == null) return null;
    try { return v as T; }
    catch { return null; }
  };

  const closingAmounts = parseJson<Record<PaymentMethod, number>>(session.closingAmounts);
  const expectedAmounts = parseJson<Record<PaymentMethod, number>>(session.expectedAmounts);
  const diffByMethod = parseJson<Record<PaymentMethod, number>>(session.diffByMethod);

  return {
    session,
    sales: sales.map((s) => ({ ...s, total: Number(s.total) })),
    purchases: purchases.map((p) => ({ ...p, total: Number(p.total) })),
    closingAmounts,
    expectedByMethod: expectedAmounts,
    diffByMethod,
    movimientos: {
      ingresoCash: Number(mov.ingresoCash),
      egresoCash: Number(mov.egresoCash),
      ingresoElectronic: Number(mov.ingresoElectronic),
      egresoElectronic: Number(mov.egresoElectronic),
      // Per-method
      ingresoByMethod: cut.movimientosIngresoByMethod,
      egresoByMethod: cut.movimientosEgresoByMethod,
    },
    movimientosPorMotivo: movPorMotivo,
    inventory,
    inventoryAdjusted: session.inventoryAdjusted ?? false,
  };
}
