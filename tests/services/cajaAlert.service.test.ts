import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { dec } from '../helpers/fixtures';
import { Prisma } from '../../generated/prisma/client.js';
import { emitToStore } from '../../src/socket/socket';
import { checkAndEmitCajaAlert, getCajaAlerts } from '../../src/services/cajaAlert.service';

// ---------------------------------------------------------------------------
// Fixtures locales
// ---------------------------------------------------------------------------

const AHORA = new Date('2026-01-15T18:00:00.000Z');

function sesionConCaja(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cajasession-1',
    cajaId: 'caja-1',
    caja: { name: 'Caja 1' },
    ...overrides,
  };
}

function sesionConSaldos(overrides: Record<string, unknown> = {}) {
  return {
    openingCash: dec('500.00'),
    openingElectronic: dec('100.00'),
    ...overrides,
  };
}

/** Fila de sesión tal como la devuelven las dos consultas del servicio. */
function sesionCompleta(overrides: Record<string, unknown> = {}) {
  return { ...sesionConCaja(), ...sesionConSaldos(), ...overrides };
}

function umbrales(overrides: Record<string, unknown> = {}) {
  return {
    umbralAlertaEfectivo: dec('50.00'),
    umbralAlertaTarjeta: dec('80.00'),
    umbralAlertaEgresos: dec('200.00'),
    ...overrides,
  };
}

/** Corte con importes en ambos métodos, útil para ejercitar las sumas. */
function corteConImportes() {
  prismaMock.sale.groupBy.mockResolvedValue([
    { paymentMethod: 'CASH', _sum: { total: dec('200.00') } },
    { paymentMethod: 'CARD', _sum: { total: dec('50.00') } },
    { paymentMethod: 'TRANSFER', _sum: { total: null } },
  ]);
  prismaMock.supplierTransaction.groupBy.mockResolvedValue([
    { paymentMethod: 'CASH', _sum: { total: dec('20.00') } },
    { paymentMethod: 'CARD', _sum: { total: dec('10.00') } },
    { paymentMethod: 'TRANSFER', _sum: { total: null } },
  ]);
  prismaMock.cajaMovimiento.findMany.mockResolvedValue([
    { tipo: 'INGRESO', metodo: 'CASH', monto: dec('30.00') },
    { tipo: 'EGRESO', metodo: 'CASH', monto: dec('10.00') },
    { tipo: 'INGRESO', metodo: 'CARD', monto: dec('5.00') },
    { tipo: 'EGRESO', metodo: 'CARD', monto: dec('5.00') },
  ]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// checkAndEmitCajaAlert
// ---------------------------------------------------------------------------

describe('checkAndEmitCajaAlert', () => {
  it('devuelve null si la sesión de caja no existe', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expect(
      checkAndEmitCajaAlert('store-1', 'cajasession-x', 'EGRESO', 'CASH', 100)
    ).resolves.toBeNull();
    expect(prismaMock.store.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.cajaAlert.create).not.toHaveBeenCalled();
  });

  it('devuelve null si la tienda no existe', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionConCaja());
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expect(
      checkAndEmitCajaAlert('store-1', 'cajasession-1', 'EGRESO', 'CASH', 100)
    ).resolves.toBeNull();
    expect(prismaMock.cajaAlert.create).not.toHaveBeenCalled();
  });

  it('no evalúa umbrales cuando el movimiento no es un egreso', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionCompleta());
    prismaMock.store.findUnique.mockResolvedValue(umbrales());
    corteConImportes();

    await expect(
      checkAndEmitCajaAlert('store-1', 'cajasession-1', 'INGRESO', 'CASH', 900)
    ).resolves.toBeNull();
    expect(prismaMock.cajaAlert.create).not.toHaveBeenCalled();
    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('devuelve null si no hay ningún umbral aplicable al egreso', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionCompleta());
    prismaMock.store.findUnique.mockResolvedValue(
      umbrales({
        umbralAlertaEfectivo: null,
        umbralAlertaTarjeta: null,
        umbralAlertaEgresos: null,
      })
    );
    corteConImportes();

    await expect(
      checkAndEmitCajaAlert('store-1', 'cajasession-1', 'EGRESO', 'CASH', 100)
    ).resolves.toBeNull();
    expect(prismaMock.cajaAlert.create).not.toHaveBeenCalled();
  });

  it('no alerta cuando el egreso no supera el umbral', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionCompleta());
    prismaMock.store.findUnique.mockResolvedValue(umbrales({ umbralAlertaEfectivo: dec('150.00') }));
    corteConImportes();

    await expect(
      checkAndEmitCajaAlert('store-1', 'cajasession-1', 'EGRESO', 'CASH', 150)
    ).resolves.toBeNull();
    expect(prismaMock.cajaAlert.create).not.toHaveBeenCalled();
    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('alerta y persiste cuando el egreso en efectivo supera el umbral de efectivo', async () => {
    prismaMock.cajaSession.findFirst
      .mockResolvedValueOnce(sesionConCaja())
      .mockResolvedValue(sesionConSaldos());
    prismaMock.store.findUnique.mockResolvedValue(umbrales());
    corteConImportes();

    // Saldo efectivo = 500 + 200 - 20 + 30 - 10 = 700
    const payload = await checkAndEmitCajaAlert(
      'store-1',
      'cajasession-1',
      'EGRESO',
      'CASH',
      120
    );

    expect(payload).toEqual({
      sessionId: 'cajasession-1',
      cajaId: 'caja-1',
      cajaName: 'Caja 1',
      tipo: 'EGRESO',
      metodo: 'CASH',
      monto: 120,
      saldoDisponible: 700,
      umbral: 50,
      sobrepaso: 70,
      excedido: true,
      triggeredAt: AHORA.toISOString(),
    });

    const datos = prismaMock.cajaAlert.create.mock.calls[0]?.[0];
    expect(datos.data).toEqual({
      storeId: 'store-1',
      cajaSessionId: 'cajasession-1',
      tipo: 'EGRESO',
      metodo: 'CASH',
      monto: expect.any(Prisma.Decimal),
      saldoDisponible: expect.any(Prisma.Decimal),
      umbral: expect.any(Prisma.Decimal),
      sobrepaso: expect.any(Prisma.Decimal),
    });
    expect(Number(datos.data.monto)).toBe(120);
    expect(Number(datos.data.sobrepaso)).toBe(70);
    expect(vi.mocked(emitToStore)).toHaveBeenCalledWith('store-1', 'caja:alert', payload);
  });

  it('usa el umbral de tarjeta para un egreso electrónico', async () => {
    prismaMock.cajaSession.findFirst
      .mockResolvedValueOnce(sesionConCaja())
      .mockResolvedValue(sesionConSaldos());
    prismaMock.store.findUnique.mockResolvedValue(umbrales());
    corteConImportes();

    // Saldo electrónico = 100 + 50 - 10 + 5 - 5 = 140
    const payload = await checkAndEmitCajaAlert(
      'store-1',
      'cajasession-1',
      'EGRESO',
      'CARD',
      100
    );

    expect(payload).toMatchObject({
      metodo: 'CARD',
      saldoDisponible: 140,
      umbral: 80,
      sobrepaso: 20,
      excedido: true,
    });
    expect(vi.mocked(emitToStore)).toHaveBeenCalledWith('store-1', 'caja:alert', payload);
  });

  it('cae al umbral general de egresos cuando no hay umbral de efectivo', async () => {
    prismaMock.cajaSession.findFirst
      .mockResolvedValueOnce(sesionConCaja())
      .mockResolvedValue(sesionConSaldos());
    prismaMock.store.findUnique.mockResolvedValue(umbrales({ umbralAlertaEfectivo: null }));
    corteConImportes();

    const payload = await checkAndEmitCajaAlert(
      'store-1',
      'cajasession-1',
      'EGRESO',
      'CASH',
      300
    );

    expect(payload).toMatchObject({ umbral: 200, sobrepaso: 100, excedido: true });
  });

  it('cae al umbral general de egresos cuando no hay umbral de tarjeta', async () => {
    prismaMock.cajaSession.findFirst
      .mockResolvedValueOnce(sesionConCaja())
      .mockResolvedValue(sesionConSaldos());
    prismaMock.store.findUnique.mockResolvedValue(umbrales({ umbralAlertaTarjeta: null }));
    corteConImportes();

    const payload = await checkAndEmitCajaAlert(
      'store-1',
      'cajasession-1',
      'EGRESO',
      'TRANSFER',
      250
    );

    expect(payload).toMatchObject({ metodo: 'TRANSFER', umbral: 200, sobrepaso: 50 });
  });

  it('usa saldo cero cuando el corte no puede leer la sesión', async () => {
    prismaMock.cajaSession.findFirst
      .mockResolvedValueOnce(sesionConCaja())
      .mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue(umbrales({ umbralAlertaEfectivo: dec('10.00') }));

    const payload = await checkAndEmitCajaAlert(
      'store-1',
      'cajasession-1',
      'EGRESO',
      'CASH',
      25
    );

    expect(payload).toMatchObject({ saldoDisponible: 0, sobrepaso: 15 });
    // Sin sesión no se consultan ventas ni movimientos.
    expect(prismaMock.sale.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.cajaMovimiento.findMany).not.toHaveBeenCalled();
  });

  it('calcula el saldo con grupos sin total (suma nula) sin romper', async () => {
    prismaMock.cajaSession.findFirst
      .mockResolvedValueOnce(sesionConCaja())
      .mockResolvedValue(sesionConSaldos({ openingCash: dec('0.00') }));
    prismaMock.store.findUnique.mockResolvedValue(umbrales({ umbralAlertaEfectivo: dec('1.00') }));
    prismaMock.sale.groupBy.mockResolvedValue([{ paymentMethod: 'CASH', _sum: { total: null } }]);
    prismaMock.supplierTransaction.groupBy.mockResolvedValue([]);
    prismaMock.cajaMovimiento.findMany.mockResolvedValue([]);

    const payload = await checkAndEmitCajaAlert(
      'store-1',
      'cajasession-1',
      'EGRESO',
      'CASH',
      5
    );

    expect(payload).toMatchObject({ saldoDisponible: 0, sobrepaso: 4 });
  });
});

// ---------------------------------------------------------------------------
// getCajaAlerts
// ---------------------------------------------------------------------------

describe('getCajaAlerts', () => {
  const filaAlerta = (overrides: Record<string, unknown> = {}) => ({
    id: 'alerta-1',
    storeId: 'store-1',
    cajaSessionId: 'cajasession-1',
    tipo: 'EGRESO',
    metodo: 'CASH',
    monto: dec('120.00'),
    saldoDisponible: dec('700.00'),
    umbral: dec('50.00'),
    sobrepaso: dec('70.00'),
    triggeredAt: new Date('2026-01-15T18:00:00.000Z'),
    session: {
      id: 'cajasession-1',
      openingDate: '2026-01-15',
      caja: { id: 'caja-1', name: 'Caja 1' },
    },
    ...overrides,
  });

  it('filtra por sesión cuando se envía el id', async () => {
    prismaMock.cajaAlert.findMany.mockResolvedValue([filaAlerta()]);

    const alertas = await getCajaAlerts('store-1', 'cajasession-1');

    expect(prismaMock.cajaAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 'store-1', cajaSessionId: 'cajasession-1' },
        orderBy: { triggeredAt: 'desc' },
        take: 100,
      })
    );
    expect(alertas).toEqual([
      {
        id: 'alerta-1',
        sessionId: 'cajasession-1',
        cajaId: 'caja-1',
        cajaName: 'Caja 1',
        tipo: 'EGRESO',
        metodo: 'CASH',
        monto: 120,
        saldoDisponible: 700,
        umbral: 50,
        sobrepaso: 70,
        triggeredAt: new Date('2026-01-15T18:00:00.000Z'),
      },
    ]);
  });

  it('consulta todas las alertas de la tienda cuando no se filtra por sesión', async () => {
    prismaMock.cajaAlert.findMany.mockResolvedValue([]);

    await expect(getCajaAlerts('store-1')).resolves.toEqual([]);
    expect(prismaMock.cajaAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 'store-1' } })
    );
  });
});
