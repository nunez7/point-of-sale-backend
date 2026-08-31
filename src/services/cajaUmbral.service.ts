import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { getCajaAlerts } from './cajaAlert.service';

export interface CajaUmbrales {
  umbralAlertaEfectivo: number | null;
  umbralAlertaTarjeta: number | null;
  umbralAlertaEgresos: number | null;
}

function toUmbrales(store: {
  umbralAlertaEfectivo: Prisma.Decimal | null;
  umbralAlertaTarjeta: Prisma.Decimal | null;
  umbralAlertaEgresos: Prisma.Decimal | null;
}): CajaUmbrales {
  return {
    umbralAlertaEfectivo:
      store.umbralAlertaEfectivo != null ? Number(store.umbralAlertaEfectivo) : null,
    umbralAlertaTarjeta:
      store.umbralAlertaTarjeta != null ? Number(store.umbralAlertaTarjeta) : null,
    umbralAlertaEgresos:
      store.umbralAlertaEgresos != null ? Number(store.umbralAlertaEgresos) : null,
  };
}

export async function getUmbrales(storeId: string): Promise<CajaUmbrales> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      umbralAlertaEfectivo: true,
      umbralAlertaTarjeta: true,
      umbralAlertaEgresos: true,
    },
  });
  if (!store) {
    return {
      umbralAlertaEfectivo: null,
      umbralAlertaTarjeta: null,
      umbralAlertaEgresos: null,
    };
  }
  return toUmbrales(store);
}

export interface CajaUmbralesInput {
  umbralAlertaEfectivo?: number | null;
  umbralAlertaTarjeta?: number | null;
  umbralAlertaEgresos?: number | null;
}

export async function updateUmbrales(
  storeId: string,
  input: CajaUmbralesInput
): Promise<CajaUmbrales> {
  const data: Prisma.StoreUpdateInput = {};

  if (input.umbralAlertaEfectivo !== undefined) {
    data.umbralAlertaEfectivo =
      input.umbralAlertaEfectivo === null
        ? null
        : new Prisma.Decimal(input.umbralAlertaEfectivo);
  }
  if (input.umbralAlertaTarjeta !== undefined) {
    data.umbralAlertaTarjeta =
      input.umbralAlertaTarjeta === null
        ? null
        : new Prisma.Decimal(input.umbralAlertaTarjeta);
  }
  if (input.umbralAlertaEgresos !== undefined) {
    data.umbralAlertaEgresos =
      input.umbralAlertaEgresos === null
        ? null
        : new Prisma.Decimal(input.umbralAlertaEgresos);
  }

  const store = await prisma.store.update({
    where: { id: storeId },
    select: {
      umbralAlertaEfectivo: true,
      umbralAlertaTarjeta: true,
      umbralAlertaEgresos: true,
    },
    data,
  });

  return toUmbrales(store);
}

export async function getAlerts(storeId: string, sessionId?: string) {
  return getCajaAlerts(storeId, sessionId);
}
