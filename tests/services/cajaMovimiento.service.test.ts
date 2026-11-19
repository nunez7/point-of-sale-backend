import { afterEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { dec } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import { Prisma } from '../../generated/prisma/client.js';
import { emitToStore } from '../../src/socket/socket';
import {
  crearMovimiento,
  listarMovimientos,
  resumenMovimientos,
  resumenMovimientosPorMetodo,
  resumenPorMotivo,
} from '../../src/services/cajaMovimiento.service';

// ---------------------------------------------------------------------------
// Fixtures locales
// ---------------------------------------------------------------------------

function sesionAbierta(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cajasession-1',
    storeId: 'store-1',
    cajaId: 'caja-1',
    userId: 'user-1',
    status: 'OPEN',
    openingCash: dec('500.00'),
    openingElectronic: dec('100.00'),
    openingDate: '2026-01-15',
    caja: { id: 'caja-1', name: 'Caja 1' },
    ...overrides,
  };
}

function filaMovimiento(overrides: Record<string, unknown> = {}) {
  return {
    id: 'movimiento-1',
    storeId: 'store-1',
    cajaSessionId: 'cajasession-1',
    userId: 'user-1',
    tipo: 'INGRESO',
    metodo: 'CASH',
    monto: dec('100.00'),
    motivoId: null,
    motivoTexto: null,
    createdAt: new Date('2026-01-15T18:00:00.000Z'),
    ...overrides,
  };
}

/** Deja el corte sin ventas, compras ni movimientos previos. */
function corteVacio() {
  prismaMock.sale.groupBy.mockResolvedValue([]);
  prismaMock.supplierTransaction.groupBy.mockResolvedValue([]);
  prismaMock.cajaMovimiento.findMany.mockResolvedValue([]);
}

/** Corte con importes en ambos métodos para ejercitar todas las sumas. */
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

function datosCreate(): any {
  return prismaMock.cajaMovimiento.create.mock.calls[0]?.[0];
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// crearMovimiento
// ---------------------------------------------------------------------------

describe('crearMovimiento', () => {
  it('registra un ingreso en efectivo, recorta el motivo libre y audita', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());
    prismaMock.cajaMovimiento.create.mockResolvedValue(
      filaMovimiento({ motivoTexto: 'Feria', monto: dec('100.00') })
    );

    const resultado = await crearMovimiento('store-1', 'user-1', 'cajasession-1', {
      tipo: 'INGRESO',
      metodo: 'CASH',
      monto: 100,
      motivoTexto: '   Feria   ',
    });

    expect(resultado).toMatchObject({ id: 'movimiento-1' });
    const datos = datosCreate();
    expect(datos.data).toEqual({
      storeId: 'store-1',
      cajaSessionId: 'cajasession-1',
      userId: 'user-1',
      tipo: 'INGRESO',
      metodo: 'CASH',
      monto: expect.any(Prisma.Decimal),
      motivoId: null,
      motivoTexto: 'Feria',
    });
    expect(Number(datos.data.monto)).toBe(100);
    expect(datos.include).toMatchObject({ user: { select: expect.any(Object) } });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        userId: 'user-1',
        action: 'MOVIMIENTO_CAJA',
        entity: 'CajaMovimiento',
        entityId: 'movimiento-1',
      }),
    });
    // Sin umbral configurado en la tienda no se emite alerta.
    expect(prismaMock.store.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'store-1' } })
    );
    expect(emitToStore).not.toHaveBeenCalled();
    // Un ingreso no consulta el saldo disponible.
    expect(prismaMock.cajaMovimiento.findMany).not.toHaveBeenCalled();
  });

  it('normaliza los métodos electrónicos a ELECTRONIC y los motivos vacíos a null', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());
    prismaMock.cajaMovimiento.create.mockResolvedValue(
      filaMovimiento({ metodo: 'ELECTRONIC', tipo: 'INGRESO' })
    );

    await crearMovimiento('store-1', 'user-1', 'cajasession-1', {
      tipo: 'INGRESO',
      metodo: 'TRANSFER',
      monto: 250.5,
      motivoTexto: '   ',
    });

    const datos = datosCreate();
    expect(datos.data.metodo).toBe('ELECTRONIC');
    expect(datos.data.motivoTexto).toBeNull();
    expect(Number(datos.data.monto)).toBe(250.5);
  });

  it('lanza CAJA_SESSION_NOT_FOUND si la sesión no existe en la tienda', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expectApiError(() => crearMovimiento('store-1', 'user-1', 'cajasession-x', {
      tipo: 'INGRESO',
      metodo: 'CASH',
      monto: 10,
    }), { status: 404, code: 'CAJA_SESSION_NOT_FOUND' });
    expect(prismaMock.cajaMovimiento.create).not.toHaveBeenCalled();
  });

  it('lanza CAJA_NO_ABIERTA si la sesión ya está cerrada', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(
      sesionAbierta({ status: 'CLOSED' })
    );

    await expectApiError(() => crearMovimiento('store-1', 'user-1', 'cajasession-1', {
      tipo: 'INGRESO',
      metodo: 'CASH',
      monto: 10,
    }), { status: 400, code: 'CAJA_NO_ABIERTA' });
    expect(prismaMock.cajaMovimiento.create).not.toHaveBeenCalled();
  });

  it('lanza CAJA_SALDO_INSUFICIENTE en efectivo cuando la sesión no permite calcular saldo', async () => {
    prismaMock.cajaSession.findFirst
      .mockResolvedValueOnce(sesionAbierta())
      .mockResolvedValueOnce(null);

    await expectApiError(
      () =>
        crearMovimiento('store-1', 'user-1', 'cajasession-1', {
          tipo: 'EGRESO',
          metodo: 'CASH',
          monto: 10,
        }),
      { status: 400, code: 'CAJA_SALDO_INSUFICIENTE', message: /efectivo/ }
    );
    expect(prismaMock.cajaMovimiento.create).not.toHaveBeenCalled();
  });

  it('permite el egreso cuando el monto iguala el saldo disponible en efectivo', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());
    corteConImportes();
    prismaMock.cajaMovimiento.create.mockResolvedValue(
      filaMovimiento({ tipo: 'EGRESO', monto: dec('700.00') })
    );

    await crearMovimiento('store-1', 'user-1', 'cajasession-1', {
      tipo: 'EGRESO',
      metodo: 'CASH',
      monto: 700,
    });

    expect(prismaMock.cajaMovimiento.create).toHaveBeenCalledTimes(1);
    expect(Number(datosCreate().data.monto)).toBe(700);
  });

  it('rechaza el egreso que supera el saldo efectivo con el detalle del disponible', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());
    corteConImportes();

    await expectApiError(
      () =>
        crearMovimiento('store-1', 'user-1', 'cajasession-1', {
          tipo: 'EGRESO',
          metodo: 'CASH',
          monto: 800,
        }),
      {
        status: 400,
        code: 'CAJA_SALDO_INSUFICIENTE',
        message: 'No hay saldo suficiente en efectivo. Disponible: 700.00, solicitado: 800.00',
      }
    );
  });

  it('rechaza el egreso electrónico con el mensaje de tarjeta', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());
    corteConImportes();

    // Saldo electrónico = 100 (apertura) + 50 (ventas) - 10 (compras) + 5 - 5 = 140
    await expectApiError(
      () =>
        crearMovimiento('store-1', 'user-1', 'cajasession-1', {
          tipo: 'EGRESO',
          metodo: 'CARD',
          monto: 200,
        }),
      {
        status: 400,
        code: 'CAJA_SALDO_INSUFICIENTE',
        message: 'No hay saldo suficiente en tarjeta. Disponible: 140.00, solicitado: 200.00',
      }
    );
  });

  it('lanza CAJA_MOTIVO_NOT_FOUND si el motivo no existe o está inactivo', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue(null);

    await expectApiError(
      () =>
        crearMovimiento('store-1', 'user-1', 'cajasession-1', {
          tipo: 'INGRESO',
          metodo: 'CASH',
          monto: 10,
          motivoId: 'motivo-x',
        }),
      { status: 400, code: 'CAJA_MOTIVO_NOT_FOUND' }
    );
    expect(prismaMock.cajaMovimiento.create).not.toHaveBeenCalled();
  });

  it('lanza CAJA_MOTIVO_TIPO_MISMATCH si el motivo es del tipo contrario', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());
    corteVacio();
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue({
      id: 'motivo-1',
      storeId: 'store-1',
      tipo: 'INGRESO',
      name: 'Feria',
      isActive: true,
    });

    await expectApiError(
      () =>
        crearMovimiento('store-1', 'user-1', 'cajasession-1', {
          tipo: 'EGRESO',
          metodo: 'CASH',
          monto: 10,
          motivoId: 'motivo-1',
        }),
      {
        status: 400,
        code: 'CAJA_MOTIVO_TIPO_MISMATCH',
        message: 'El motivo "Feria" es de tipo INGRESO, no EGRESO',
      }
    );
    expect(prismaMock.cajaMovimientoMotivo.findFirst).toHaveBeenCalledWith({
      where: { id: 'motivo-1', storeId: 'store-1', isActive: true },
    });
  });

  it('guarda el motivoId validado cuando coincide el tipo', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());
    corteVacio();
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue({
      id: 'motivo-1',
      storeId: 'store-1',
      tipo: 'EGRESO',
      name: 'Retiro',
      isActive: true,
    });
    prismaMock.cajaMovimiento.create.mockResolvedValue(
      filaMovimiento({ tipo: 'EGRESO', motivoId: 'motivo-1' })
    );

    await crearMovimiento('store-1', 'user-1', 'cajasession-1', {
      tipo: 'EGRESO',
      metodo: 'CASH',
      monto: 50,
      motivoId: 'motivo-1',
    });

    expect(datosCreate().data.motivoId).toBe('motivo-1');
  });

  it('delega en la alerta de caja cuando el egreso supera el umbral de la tienda', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());
    corteVacio();
    prismaMock.store.findUnique.mockResolvedValue({
      umbralAlertaEfectivo: dec('50.00'),
      umbralAlertaTarjeta: null,
      umbralAlertaEgresos: null,
    });
    prismaMock.cajaMovimiento.create.mockResolvedValue(
      filaMovimiento({ tipo: 'EGRESO', monto: dec('120.00') })
    );

    await crearMovimiento('store-1', 'user-1', 'cajasession-1', {
      tipo: 'EGRESO',
      metodo: 'CASH',
      monto: 120,
    });

    expect(prismaMock.cajaAlert.create).toHaveBeenCalledTimes(1);
    expect(emitToStore).toHaveBeenCalledWith(
      'store-1',
      'caja:alert',
      expect.objectContaining({ sessionId: 'cajasession-1', monto: 120, umbral: 50, sobrepaso: 70 })
    );
  });
});

// ---------------------------------------------------------------------------
// listarMovimientos
// ---------------------------------------------------------------------------

describe('listarMovimientos', () => {
  it('devuelve los movimientos de la sesión ordenados del más reciente', async () => {
    const filas = [filaMovimiento()];
    prismaMock.cajaSession.findFirst.mockResolvedValue({ id: 'cajasession-1' });
    prismaMock.cajaMovimiento.findMany.mockResolvedValue(filas);

    await expect(listarMovimientos('store-1', 'cajasession-1')).resolves.toEqual(filas);
    expect(prismaMock.cajaMovimiento.findMany).toHaveBeenCalledWith({
      where: { cajaSessionId: 'cajasession-1', storeId: 'store-1' },
      include: expect.anything(),
      orderBy: { createdAt: 'desc' },
    });
  });

  it('lanza CAJA_SESSION_NOT_FOUND si la sesión no pertenece a la tienda', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expectApiError(() => listarMovimientos('store-1', 'cajasession-x'), {
      status: 404,
      code: 'CAJA_SESSION_NOT_FOUND',
    });
    expect(prismaMock.cajaMovimiento.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resumenMovimientos
// ---------------------------------------------------------------------------

describe('resumenMovimientos', () => {
  it('acumula ingresos y egresos separando efectivo de electrónico', async () => {
    prismaMock.cajaMovimiento.findMany.mockResolvedValue([
      { tipo: 'INGRESO', metodo: 'CASH', monto: dec('100.00') },
      { tipo: 'INGRESO', metodo: 'CARD', monto: dec('50.00') },
      { tipo: 'EGRESO', metodo: 'CASH', monto: dec('30.00') },
      { tipo: 'EGRESO', metodo: 'TRANSFER', monto: dec('20.00') },
    ]);

    const resumen = await resumenMovimientos('cajasession-1', 'store-1');

    expect(Number(resumen.ingresoCash)).toBe(100);
    expect(Number(resumen.ingresoElectronic)).toBe(50);
    expect(Number(resumen.egresoCash)).toBe(30);
    expect(Number(resumen.egresoElectronic)).toBe(20);
    expect(prismaMock.cajaMovimiento.findMany).toHaveBeenCalledWith({
      where: { cajaSessionId: 'cajasession-1', storeId: 'store-1' },
      select: { tipo: true, metodo: true, monto: true },
    });
  });

  it('devuelve ceros cuando no hay movimientos', async () => {
    prismaMock.cajaMovimiento.findMany.mockResolvedValue([]);

    const resumen = await resumenMovimientos('cajasession-1', 'store-1');

    expect([
      Number(resumen.ingresoCash),
      Number(resumen.ingresoElectronic),
      Number(resumen.egresoCash),
      Number(resumen.egresoElectronic),
    ]).toEqual([0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// resumenMovimientosPorMetodo
// ---------------------------------------------------------------------------

describe('resumenMovimientosPorMetodo', () => {
  it('desglosa por método y agrupa el ELECTRONIC heredado en OTHER', async () => {
    prismaMock.cajaMovimiento.findMany.mockResolvedValue([
      { tipo: 'INGRESO', metodo: 'CASH', monto: dec('100.00') },
      { tipo: 'EGRESO', metodo: 'CASH', monto: dec('30.00') },
      { tipo: 'INGRESO', metodo: 'CARD', monto: dec('50.00') },
      { tipo: 'EGRESO', metodo: 'ELECTRONIC', monto: dec('10.00') },
      { tipo: 'INGRESO', metodo: 'FOO', monto: dec('5.00') },
      { tipo: 'EGRESO', metodo: 'FOO', monto: dec('2.00') },
    ]);

    const resumen = await resumenMovimientosPorMetodo('cajasession-1', 'store-1');

    expect(Number(resumen.ingreso.CASH)).toBe(100);
    expect(Number(resumen.egreso.CASH)).toBe(30);
    expect(Number(resumen.ingreso.CARD)).toBe(50);
    expect(Number(resumen.ingreso.OTHER)).toBe(0);
    expect(Number(resumen.egreso.OTHER)).toBe(10);
    // Un método desconocido se acumula sin perder el importe.
    expect(Number(resumen.ingreso.FOO)).toBe(5);
    expect(Number(resumen.egreso.FOO)).toBe(2);
    expect(Number(resumen.ingreso.TRANSFER)).toBe(0);
    expect(Number(resumen.egreso.CREDIT)).toBe(0);
  });

  it('inicializa los cinco métodos de pago en cero', async () => {
    prismaMock.cajaMovimiento.findMany.mockResolvedValue([]);

    const resumen = await resumenMovimientosPorMetodo('cajasession-1', 'store-1');

    expect(Object.keys(resumen.ingreso).sort()).toEqual([
      'CARD',
      'CASH',
      'CREDIT',
      'OTHER',
      'TRANSFER',
    ]);
    expect(Object.keys(resumen.egreso).sort()).toEqual([
      'CARD',
      'CASH',
      'CREDIT',
      'OTHER',
      'TRANSFER',
    ]);
  });
});

// ---------------------------------------------------------------------------
// resumenPorMotivo
// ---------------------------------------------------------------------------

describe('resumenPorMotivo', () => {
  it('agrupa por motivo, texto libre y sin motivo, sumando los repetidos', async () => {
    prismaMock.cajaMovimiento.findMany.mockResolvedValue([
      {
        tipo: 'INGRESO',
        metodo: 'CASH',
        monto: dec('100.00'),
        motivoId: 'motivo-1',
        motivoTexto: null,
        motivo: { name: 'Feria' },
      },
      {
        tipo: 'INGRESO',
        metodo: 'CASH',
        monto: dec('50.00'),
        motivoId: 'motivo-1',
        motivoTexto: null,
        motivo: { name: 'Feria' },
      },
      {
        tipo: 'EGRESO',
        metodo: 'CASH',
        monto: dec('40.00'),
        motivoId: null,
        motivoTexto: 'Compra de agua',
        motivo: null,
      },
      {
        tipo: 'EGRESO',
        metodo: 'CARD',
        monto: dec('20.00'),
        motivoId: null,
        motivoTexto: null,
        motivo: null,
      },
    ]);

    const resumen = await resumenPorMotivo('cajasession-1', 'store-1');

    expect(resumen).toHaveLength(3);
    expect(resumen[0]).toEqual({
      motivoId: 'motivo-1',
      motivoName: 'Feria',
      motivoTexto: null,
      tipo: 'INGRESO',
      metodo: 'CASH',
      total: 150,
      cantidad: 2,
    });
    expect(resumen[1]).toMatchObject({
      motivoName: 'Otro (texto libre)',
      motivoTexto: 'Compra de agua',
      total: 40,
      cantidad: 1,
    });
    expect(resumen[2]).toMatchObject({
      motivoId: null,
      motivoName: 'Sin motivo',
      motivoTexto: null,
      metodo: 'CARD',
      total: 20,
      cantidad: 1,
    });
    expect(prismaMock.cajaMovimiento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' } })
    );
  });

  it('devuelve una lista vacía cuando no hay movimientos', async () => {
    prismaMock.cajaMovimiento.findMany.mockResolvedValue([]);

    await expect(resumenPorMotivo('cajasession-1', 'store-1')).resolves.toEqual([]);
  });
});
