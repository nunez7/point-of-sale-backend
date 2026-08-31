import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { resumenMovimientos } from './cajaMovimiento.service';

export interface CajaAlertPayload {
  sessionId: string;
  cajaId: string;
  cajaName: string;
  tipo: string;
  metodo: string;
  monto: number;
  saldoDisponible: number;
  umbral: number;
  sobrepaso: number;
  excedido: boolean;
  triggeredAt: string;
}

function getInternalMetodo(metodo: string): 'CASH' | 'ELECTRONIC' {
  if (metodo === 'CASH') return 'CASH';
  return 'ELECTRONIC';
}

async function getSessionSaldo(
  sessionId: string,
  storeId: string,
  metodo: 'CASH' | 'ELECTRONIC'
): Promise<Prisma.Decimal> {
  const session = await prisma.cajaSession.findFirst({
    where: { id: sessionId, storeId },
    select: {
      openingCash: true,
      openingElectronic: true,
    },
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

export async function checkAndEmitCajaAlert(
  storeId: string,
  sessionId: string,
  tipo: string,
  metodo: string,
  monto: number
): Promise<CajaAlertPayload | null> {
  const session = await prisma.cajaSession.findFirst({
    where: { id: sessionId, storeId },
    select: { id: true, cajaId: true, caja: { select: { name: true } } },
  });
  if (!session) return null;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      umbralAlertaEfectivo: true,
      umbralAlertaTarjeta: true,
      umbralAlertaEgresos: true,
    },
  });
  if (!store) return null;

  const internalMetodo = getInternalMetodo(metodo);
  const saldoDisponible = await getSessionSaldo(sessionId, storeId, internalMetodo);

  let umbral: Prisma.Decimal | null = null;
  let alertType: 'efectivo' | 'tarjeta' | 'egresos' | null = null;

  if (tipo === 'EGRESO') {
    if (internalMetodo === 'CASH' && store.umbralAlertaEfectivo != null) {
      umbral = store.umbralAlertaEfectivo;
      alertType = 'efectivo';
    } else if (internalMetodo === 'ELECTRONIC' && store.umbralAlertaTarjeta != null) {
      umbral = store.umbralAlertaTarjeta;
      alertType = 'tarjeta';
    } else if (store.umbralAlertaEgresos != null) {
      umbral = store.umbralAlertaEgresos;
      alertType = 'egresos';
    }
  }

  if (!umbral || !alertType) return null;

  const umbralNum = Number(umbral);
  const saldoNum = Number(saldoDisponible);
  const montoNum = Number(monto);
  const excedido = montoNum > umbralNum;
  const sobrepaso = Math.max(0, montoNum - umbralNum);

  if (!excedido) return null;

  const payload: CajaAlertPayload = {
    sessionId,
    cajaId: session.cajaId,
    cajaName: session.caja.name,
    tipo,
    metodo,
    monto: montoNum,
    saldoDisponible: saldoNum,
    umbral: umbralNum,
    sobrepaso,
    excedido,
    triggeredAt: new Date().toISOString(),
  };

  await prisma.cajaAlert.create({
    data: {
      storeId,
      cajaSessionId: sessionId,
      tipo,
      metodo,
      monto: new Prisma.Decimal(montoNum),
      saldoDisponible,
      umbral,
      sobrepaso: new Prisma.Decimal(sobrepaso),
    },
  });

  const { emitToStore } = require('../socket/socket');
  emitToStore(storeId, 'caja:alert', payload);

  return payload;
}

export async function getCajaAlerts(storeId: string, sessionId?: string) {
  const where: Record<string, unknown> = { storeId };
  if (sessionId) where.cajaSessionId = sessionId;

  const alerts = await prisma.cajaAlert.findMany({
    where,
    include: {
      session: {
        select: {
          id: true,
          caja: { select: { id: true, name: true } },
          openingDate: true,
        },
      },
    },
    orderBy: { triggeredAt: 'desc' },
    take: 100,
  });

  return alerts.map((a) => ({
    id: a.id,
    sessionId: a.cajaSessionId,
    cajaId: a.session.caja.id,
    cajaName: a.session.caja.name,
    tipo: a.tipo,
    metodo: a.metodo,
    monto: Number(a.monto),
    saldoDisponible: Number(a.saldoDisponible),
    umbral: Number(a.umbral),
    sobrepaso: Number(a.sobrepaso),
    triggeredAt: a.triggeredAt,
  }));
}
