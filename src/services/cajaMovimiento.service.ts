import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';

export interface MovimientoInput {
  tipo: 'INGRESO' | 'EGRESO';
  metodo: 'CASH' | 'ELECTRONIC';
  monto: number;
  motivo: string;
}

const movimientoInclude = {
  user: { select: { id: true, name: true } },
} satisfies Prisma.CajaMovimientoInclude;

// Registra un ingreso o egreso de dinero sobre una sesión abierta de caja.
// Afecta el corte esperado según su método (efectivo o electrónico).
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
  const movimiento = await prisma.cajaMovimiento.create({
    data: {
      storeId,
      cajaSessionId: sessionId,
      userId,
      tipo: data.tipo,
      metodo: data.metodo,
      monto,
      motivo: data.motivo,
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
      metodo: data.metodo,
      monto: data.monto,
      motivo: data.motivo,
    },
  });

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
