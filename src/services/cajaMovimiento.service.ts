import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { checkAndEmitCajaAlert } from './cajaAlert.service';

export interface MovimientoInput {
  tipo: 'INGRESO' | 'EGRESO';
  metodo: 'CASH' | 'ELECTRONIC' | 'CARD' | 'TRANSFER';
  monto: number;
  motivoId?: string | null;
  motivoTexto?: string | null;
}

const movimientoInclude = {
  user: { select: { id: true, name: true } },
  motivo: { select: { id: true, name: true, tipo: true } },
} satisfies Prisma.CajaMovimientoInclude;

function toInternalMetodo(metodo: string): 'CASH' | 'ELECTRONIC' {
  return metodo === 'CASH' ? 'CASH' : 'ELECTRONIC';
}

async function calcularSaldo(
  sessionId: string,
  storeId: string,
  metodo: 'CASH' | 'ELECTRONIC'
): Promise<Prisma.Decimal> {
  const session = await prisma.cajaSession.findFirst({
    where: { id: sessionId, storeId },
    select: { openingCash: true, openingElectronic: true },
  });
  if (!session) return new Prisma.Decimal(0);

  const mov = await resumenMovimientos(sessionId, storeId);

  const saleGroups = await prisma.sale.groupBy({
    by: ['paymentMethod'],
    where: { cajaSessionId: sessionId, storeId, status: 'COMPLETED' },
    _sum: { total: true },
  });

  const purchaseGroups = await prisma.supplierTransaction.groupBy({
    by: ['paymentMethod'],
    where: { cajaSessionId: sessionId, storeId, status: 'COMPLETED', paidFrom: 'CAJA' },
    _sum: { total: true },
  });

  const ELECTRONIC_METHODS = ['CARD', 'TRANSFER', 'CREDIT', 'OTHER'];
  const isElectronicMethod = (m: string) => ELECTRONIC_METHODS.includes(m);

  let salesCash = new Prisma.Decimal(0);
  let salesElectronic = new Prisma.Decimal(0);
  let purchasesCash = new Prisma.Decimal(0);
  let purchasesElectronic = new Prisma.Decimal(0);

  for (const g of saleGroups) {
    const total = g._sum.total ?? new Prisma.Decimal(0);
    if (isElectronicMethod(g.paymentMethod)) salesElectronic = salesElectronic.plus(total);
    else salesCash = salesCash.plus(total);
  }

  for (const g of purchaseGroups) {
    const total = g._sum.total ?? new Prisma.Decimal(0);
    if (isElectronicMethod(g.paymentMethod)) purchasesElectronic = purchasesElectronic.plus(total);
    else purchasesCash = purchasesCash.plus(total);
  }

  if (metodo === 'CASH') {
    return new Prisma.Decimal(session.openingCash)
      .plus(salesCash)
      .minus(purchasesCash)
      .plus(mov.ingresoCash)
      .minus(mov.egresoCash);
  } else {
    return new Prisma.Decimal(session.openingElectronic)
      .plus(salesElectronic)
      .minus(purchasesElectronic)
      .plus(mov.ingresoElectronic)
      .minus(mov.egresoElectronic);
  }
}

// Registra un ingreso o egreso de dinero sobre una sesión abierta de caja.
// Afecta el corte esperado según su método (efectivo o electrónico).
// Valida que un egreso no supere el saldo disponible en el método.
export async function crearMovimiento(
  storeId: string,
  userId: string,
  sessionId: string,
  data: MovimientoInput
) {
  const session = await prisma.cajaSession.findFirst({
    where: { id: sessionId, storeId },
    select: { id: true, status: true, cajaId: true },
  });
  if (!session) throw ApiError.notFound('Sesión de caja no encontrada', 'CAJA_SESSION_NOT_FOUND');
  if (session.status !== 'OPEN') {
    throw ApiError.badRequest(
      'Solo se pueden registrar movimientos en una sesión abierta',
      'CAJA_NO_ABIERTA'
    );
  }

  const monto = new Prisma.Decimal(data.monto);
  const internalMetodo = toInternalMetodo(data.metodo);

  // Si es egreso, validar que la caja tenga saldo suficiente en el método.
  if (data.tipo === 'EGRESO') {
    const saldoDisponible = await calcularSaldo(sessionId, storeId, internalMetodo);
    if (monto.greaterThan(saldoDisponible)) {
      throw ApiError.badRequest(
        `No hay saldo suficiente en ${internalMetodo === 'CASH' ? 'efectivo' : 'tarjeta'}. ` +
          `Disponible: ${saldoDisponible.toFixed(2)}, solicitado: ${monto.toFixed(2)}`,
        'CAJA_SALDO_INSUFICIENTE'
      );
    }
  }

  // Resolver motivo: si se envía motivoId, validar que exista y pertenezca a la tienda.
  // motivoTexto se usa cuando el motivo seleccionado es "Otro" o no se eligió uno.
  let motivoTexto: string | null = null;
  if (data.motivoId) {
    const motivo = await prisma.cajaMovimientoMotivo.findFirst({
      where: { id: data.motivoId, storeId, isActive: true },
    });
    if (!motivo) {
      throw ApiError.badRequest('Motivo no encontrado o inactivo', 'CAJA_MOTIVO_NOT_FOUND');
    }
    if (motivo.tipo !== data.tipo) {
      throw ApiError.badRequest(
        `El motivo "${motivo.name}" es de tipo ${motivo.tipo}, no ${data.tipo}`,
        'CAJA_MOTIVO_TIPO_MISMATCH'
      );
    }
  }
  motivoTexto = data.motivoTexto?.trim() || null;

  const movimiento = await prisma.cajaMovimiento.create({
    data: {
      storeId,
      cajaSessionId: sessionId,
      userId,
      tipo: data.tipo,
      metodo: internalMetodo,
      monto,
      motivoId: data.motivoId ?? null,
      motivoTexto,
    },
    include: movimientoInclude,
  });

  await audit({
    storeId,
    userId,
    action: 'MOVIMIENTO_CAJA',
    entity: 'CajaMovimiento',
    entityId: movimiento.id,
    metadata: {
      cajaSessionId: sessionId,
      tipo: data.tipo,
      metodo: internalMetodo,
      monto: data.monto,
      motivoId: data.motivoId ?? null,
      motivoTexto,
    },
  });

  // Evaluar umbral y emitir alerta si corresponde (alerta suave, no bloquea).
  await checkAndEmitCajaAlert(storeId, sessionId, data.tipo, internalMetodo, data.monto);

  return movimiento;
}

export async function listarMovimientos(storeId: string, sessionId: string) {
  const session = await prisma.cajaSession.findFirst({
    where: { id: sessionId, storeId },
    select: { id: true },
  });
  if (!session) throw ApiError.notFound('Sesión de caja no encontrada', 'CAJA_SESSION_NOT_FOUND');

  return prisma.cajaMovimiento.findMany({
    where: { cajaSessionId: sessionId, storeId },
    include: movimientoInclude,
    orderBy: { createdAt: 'desc' },
  });
}

// Suma de movimientos de una sesión por tipo y método, para componer el corte.
export interface ResumenMovimientos {
  ingresoCash: Prisma.Decimal;
  egresoCash: Prisma.Decimal;
  ingresoElectronic: Prisma.Decimal;
  egresoElectronic: Prisma.Decimal;
}

// Resumen de movimientos desglosado por método de pago real (CASH, CARD,
// TRANSFER, CREDIT, OTHER). Devuelve un record por cada PaymentMethod con
// los totales de ingreso y egreso.
export interface ResumenMovimientosPorMetodo {
  ingreso: Record<string, Prisma.Decimal>;
  egreso: Record<string, Prisma.Decimal>;
}

export async function resumenMovimientosPorMetodo(
  sessionId: string,
  storeId: string
): Promise<ResumenMovimientosPorMetodo> {
  const rows = await prisma.cajaMovimiento.findMany({
    where: { cajaSessionId: sessionId, storeId },
    select: { tipo: true, metodo: true, monto: true },
  });

  const zero: Record<string, Prisma.Decimal> = {
    CASH: new Prisma.Decimal(0),
    CARD: new Prisma.Decimal(0),
    TRANSFER: new Prisma.Decimal(0),
    CREDIT: new Prisma.Decimal(0),
    OTHER: new Prisma.Decimal(0),
  };
  const ingreso: Record<string, Prisma.Decimal> = { ...zero };
  const egreso: Record<string, Prisma.Decimal> = { ...zero };

  for (const r of rows) {
    // Compatibilidad: 'ELECTRONIC' (legacy) se reparte proporcionalmente no
    // es posible sin info del método real, así que lo agrupamos en OTHER para
    // no perder el total.
    const metodo = r.metodo === 'ELECTRONIC' ? 'OTHER' : r.metodo;
    if (r.tipo === 'INGRESO') {
      ingreso[metodo] = (ingreso[metodo] ?? new Prisma.Decimal(0)).plus(r.monto);
    } else {
      egreso[metodo] = (egreso[metodo] ?? new Prisma.Decimal(0)).plus(r.monto);
    }
  }
  return { ingreso, egreso };
}

export interface ResumenPorMotivo {
  motivoId: string | null;
  motivoName: string;
  motivoTexto: string | null;
  tipo: 'INGRESO' | 'EGRESO';
  metodo: string;
  total: number;
  cantidad: number;
}

export async function resumenPorMotivo(
  sessionId: string,
  storeId: string
): Promise<ResumenPorMotivo[]> {
  const rows = await prisma.cajaMovimiento.findMany({
    where: { cajaSessionId: sessionId, storeId },
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

  const groups = new Map<string, ResumenPorMotivo & { _total: Prisma.Decimal; _cantidad: number }>();
  for (const r of rows) {
    const motivoName = r.motivo?.name ?? (r.motivoTexto ? 'Otro (texto libre)' : 'Sin motivo');
    const key = `${r.tipo}|${r.metodo}|${r.motivoId ?? ''}|${r.motivoTexto ?? ''}|${motivoName}`;
    const existing = groups.get(key);
    if (existing) {
      existing._total = existing._total.plus(r.monto);
      existing._cantidad += 1;
    } else {
      groups.set(key, {
        motivoId: r.motivoId ?? null,
        motivoName,
        motivoTexto: r.motivoTexto ?? null,
        tipo: r.tipo as 'INGRESO' | 'EGRESO',
        metodo: r.metodo,
        total: 0,
        cantidad: 0,
        _total: new Prisma.Decimal(r.monto),
        _cantidad: 1,
      });
    }
  }
  return Array.from(groups.values()).map((g) => {
    const { _total, _cantidad, ...rest } = g;
    return { ...rest, total: Number(_total), cantidad: _cantidad };
  });
}

export async function resumenMovimientos(
  sessionId: string,
  storeId: string
): Promise<ResumenMovimientos> {
  const rows = await prisma.cajaMovimiento.findMany({
    where: { cajaSessionId: sessionId, storeId },
    select: { tipo: true, metodo: true, monto: true },
  });

  let ingresoCash = new Prisma.Decimal(0);
  let egresoCash = new Prisma.Decimal(0);
  let ingresoElectronic = new Prisma.Decimal(0);
  let egresoElectronic = new Prisma.Decimal(0);

  for (const r of rows) {
    const m = r.monto;
    if (r.tipo === 'INGRESO') {
      if (r.metodo === 'CASH') ingresoCash = ingresoCash.plus(m);
      else ingresoElectronic = ingresoElectronic.plus(m);
    } else {
      if (r.metodo === 'CASH') egresoCash = egresoCash.plus(m);
      else egresoElectronic = egresoElectronic.plus(m);
    }
  }

  return { ingresoCash, egresoCash, ingresoElectronic, egresoElectronic };
}
