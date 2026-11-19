import { afterEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { Prisma } from '../../generated/prisma/client.js';
import { prismaMock } from '../helpers/prismaMock';
import { cajaFixture, cajaSessionFixture, dec } from '../helpers/fixtures';
import type { CajaRow, CajaSessionRow } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import { env } from '../../src/config/env';
import {
  calcularCorte,
  closeCaja,
  findOpenSessionForCaja,
  getActiveSession,
  getSessionReport,
  listSessions,
  openCaja,
  previsualizarCorte,
  reopenCaja,
  requireOpenSession,
  resolveCajaSession,
} from '../../src/services/cajaSession.service';

// ───────────────────────────────────────────────────────────────────────────
// Utilidades locales
// ───────────────────────────────────────────────────────────────────────────

/** 18:00 UTC = 11:00 en America/Mazatlan: día de negocio 2026-01-15. */
const HOY = new Date('2026-01-15T18:00:00.000Z');
const INICIO_DIA = new Date('2026-01-15T07:00:00.000Z');

function fijarHoy(fecha: Date = HOY): void {
  vi.useFakeTimers();
  vi.setSystemTime(fecha);
}

afterEach(() => {
  vi.useRealTimers();
});

/** Sesión con la relación `caja` que devuelven las consultas con include. */
function sesionFila(overrides: Partial<CajaSessionRow> = {}) {
  return { ...cajaSessionFixture(overrides), caja: { id: 'caja-1', name: 'Caja 1' } };
}

function cajaFila(overrides: Partial<CajaRow> = {}) {
  return cajaFixture({ id: 'caja-1', ...overrides });
}

interface OpcionesApertura {
  caja?: CajaRow | null;
  sesionAbierta?: unknown;
  sesionHoy?: unknown;
  store?: { aperturaCajaConInventario: boolean } | null;
  creada?: Record<string, unknown>;
  inventario?: { productId: string; quantity: Prisma.Decimal }[];
}

function prepararApertura(opciones: OpcionesApertura = {}): void {
  prismaMock.caja.findFirst.mockResolvedValue(
    opciones.caja === undefined ? cajaFila() : opciones.caja
  );
  prismaMock.cajaSession.findFirst
    .mockResolvedValueOnce(opciones.sesionAbierta ?? null)
    .mockResolvedValueOnce(opciones.sesionHoy ?? null);
  prismaMock.store.findUnique.mockResolvedValue(
    opciones.store === undefined ? { aperturaCajaConInventario: false } : opciones.store
  );
  prismaMock.cajaSession.create.mockResolvedValue(
    opciones.creada ?? { id: 'cajasession-1', status: 'OPEN', cajaId: 'caja-1' }
  );
  prismaMock.inventory.findMany.mockResolvedValue(opciones.inventario ?? []);
}

interface OpcionesCorte {
  ventas?: { paymentMethod: string; _sum: { total: Prisma.Decimal | null } }[];
  compras?: { paymentMethod: string; _sum: { total: Prisma.Decimal | null } }[];
  movimientos?: { tipo: string; metodo: string; monto: Prisma.Decimal }[];
}

/** Deja el corte con los agregados indicados (por defecto, todo en cero). */
function mockearCorte(opciones: OpcionesCorte = {}): void {
  prismaMock.sale.groupBy.mockResolvedValue(opciones.ventas ?? []);
  prismaMock.supplierTransaction.groupBy.mockResolvedValue(opciones.compras ?? []);
  prismaMock.cajaMovimiento.findMany.mockResolvedValue(opciones.movimientos ?? []);
}

function tokenApertura(payload: Record<string, unknown> = {}): string {
  return jwt.sign(
    { storeId: 'store-1', role: 'GERENTE', purpose: 'OPEN_CAJA', ...payload },
    env.JWT_SECRET
  );
}

function tokenCierre(payload: Record<string, unknown> = {}): string {
  return jwt.sign(
    { storeId: 'store-1', role: 'ADMIN', purpose: 'CLOSE_CAJA', ...payload },
    env.JWT_SECRET
  );
}

// ───────────────────────────────────────────────────────────────────────────
// openCaja
// ───────────────────────────────────────────────────────────────────────────

describe('openCaja', () => {
  it('abre la caja como administrador, guarda el día de negocio y audita', async () => {
    fijarHoy();
    prepararApertura();

    const resultado = await openCaja('store-1', 'user-1', 'ADMIN', 'caja-1', {
      openingCash: 500,
      openingElectronic: 0,
      openingNote: 'Turno mañana',
    });

    expect(resultado).toMatchObject({ id: 'cajasession-1' });
    expect(prismaMock.caja.findFirst).toHaveBeenCalledWith({
      where: { id: 'caja-1', storeId: 'store-1' },
    });

    const datos = prismaMock.cajaSession.create.mock.calls[0]?.[0] as any;
    expect(datos.data).toMatchObject({
      storeId: 'store-1',
      cajaId: 'caja-1',
      userId: 'user-1',
      openingDate: '2026-01-15',
      openingNote: 'Turno mañana',
      inventoryAdjusted: false,
      status: 'OPEN',
    });
    expect(datos.data.openedAt).toEqual(HOY);
    expect(Number(datos.data.openingCash)).toBe(500);
    expect(Number(datos.data.openingElectronic)).toBe(0);

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        userId: 'user-1',
        action: 'OPEN_CAJA',
        entity: 'CajaSession',
        entityId: 'cajasession-1',
        metadata: { cajaId: 'caja-1', openingCash: 500, openingElectronic: 0 },
      }),
    });
    // La tienda no usa inventario en la apertura: no se captura snapshot.
    expect(prismaMock.inventory.findMany).not.toHaveBeenCalled();
  });

  it('deja la nota de apertura en null cuando no se envía', async () => {
    prepararApertura();

    await openCaja('store-1', 'user-1', 'GERENTE', 'caja-1', {
      openingCash: 100,
      openingElectronic: 50,
    });

    const datos = prismaMock.cajaSession.create.mock.calls[0]?.[0] as any;
    expect(datos.data.openingNote).toBeNull();
  });

  it('lanza CAJA_NOT_FOUND cuando la caja no existe en la tienda', async () => {
    prepararApertura({ caja: null });

    await expectApiError(
      () => openCaja('store-1', 'user-1', 'ADMIN', 'caja-9', { openingCash: 100, openingElectronic: 0 }),
      { status: 404, code: 'CAJA_NOT_FOUND', message: 'Caja no encontrada' }
    );
    expect(prismaMock.cajaSession.create).not.toHaveBeenCalled();
  });

  it('lanza CAJA_INACTIVE cuando la caja está desactivada', async () => {
    prepararApertura({ caja: cajaFila({ isActive: false }) });

    await expectApiError(
      () => openCaja('store-1', 'user-1', 'ADMIN', 'caja-1', { openingCash: 100, openingElectronic: 0 }),
      { status: 400, code: 'CAJA_INACTIVE', message: 'La caja está inactiva' }
    );
  });

  it('exige autorización al vendedor', async () => {
    prepararApertura();

    await expectApiError(
      () => openCaja('store-1', 'user-1', 'VENDEDOR', 'caja-1', { openingCash: 100, openingElectronic: 0 }),
      {
        status: 403,
        code: 'OPEN_CAJA_AUTHORIZATION_REQUIRED',
        message: 'Se requiere autorización de un administrador o gerente para abrir la caja',
      }
    );
  });

  it('rechaza una autorización de otra tienda', async () => {
    prepararApertura();

    await expectApiError(
      () =>
        openCaja('store-1', 'user-1', 'VENDEDOR', 'caja-1', {
          openingCash: 100,
          openingElectronic: 0,
          authorizationToken: tokenApertura({ storeId: 'store-2' }),
        }),
      { status: 403, code: 'OPEN_CAJA_AUTHORIZATION_INVALID' }
    );
  });

  it('rechaza una autorización de un vendedor', async () => {
    prepararApertura();

    await expectApiError(
      () =>
        openCaja('store-1', 'user-1', 'VENDEDOR', 'caja-1', {
          openingCash: 100,
          openingElectronic: 0,
          authorizationToken: tokenApertura({ role: 'VENDEDOR' }),
        }),
      { status: 403, code: 'OPEN_CAJA_AUTHORIZATION_INVALID' }
    );
  });

  it('rechaza una autorización con otro propósito', async () => {
    prepararApertura();

    await expectApiError(
      () =>
        openCaja('store-1', 'user-1', 'VENDEDOR', 'caja-1', {
          openingCash: 100,
          openingElectronic: 0,
          authorizationToken: tokenApertura({ purpose: 'CLOSE_CAJA' }),
        }),
      { status: 403, code: 'OPEN_CAJA_AUTHORIZATION_INVALID' }
    );
  });

  it('rechaza un token firmado con otra clave', async () => {
    prepararApertura();
    const ajeno = jwt.sign(
      { storeId: 'store-1', role: 'ADMIN', purpose: 'OPEN_CAJA' },
      'otro-secreto-de-pruebas-con-mas-de-32-caracteres'
    );

    await expectApiError(
      () =>
        openCaja('store-1', 'user-1', 'VENDEDOR', 'caja-1', {
          openingCash: 100,
          openingElectronic: 0,
          authorizationToken: ajeno,
        }),
      {
        status: 403,
        code: 'OPEN_CAJA_AUTHORIZATION_INVALID',
        message: 'La autorización de apertura no es válida o ya expiró',
      }
    );
  });

  it('permite al vendedor abrir con autorización de gerente y fondo electrónico', async () => {
    prepararApertura();

    const resultado = await openCaja('store-1', 'user-1', 'VENDEDOR', 'caja-1', {
      openingCash: 0,
      openingElectronic: 250,
      authorizationToken: tokenApertura(),
    });

    expect(resultado).toMatchObject({ id: 'cajasession-1' });
    const datos = prismaMock.cajaSession.create.mock.calls[0]?.[0] as any;
    expect(Number(datos.data.openingElectronic)).toBe(250);
  });

  it('lanza CAJA_YA_ABIERTA si la caja ya tiene una sesión abierta', async () => {
    prepararApertura({ sesionAbierta: sesionFila() });

    await expectApiError(
      () => openCaja('store-1', 'user-1', 'ADMIN', 'caja-1', { openingCash: 100, openingElectronic: 0 }),
      { status: 400, code: 'CAJA_YA_ABIERTA', message: 'Esta caja ya tiene una sesión abierta' }
    );
  });

  it('lanza CAJA_APERTURA_SIN_FONDOS cuando ambos montos son cero', async () => {
    prepararApertura();

    await expectApiError(
      () => openCaja('store-1', 'user-1', 'ADMIN', 'caja-1', { openingCash: 0, openingElectronic: 0 }),
      {
        status: 400,
        code: 'CAJA_APERTURA_SIN_FONDOS',
        message: 'Debe registrar dinero de apertura (efectivo o electrónico) para abrir la caja',
      }
    );
  });

  it('trata los montos ausentes como cero al validar el fondo', async () => {
    prepararApertura();

    await expectApiError(
      () => openCaja('store-1', 'user-1', 'ADMIN', 'caja-1', {} as any),
      { status: 400, code: 'CAJA_APERTURA_SIN_FONDOS' }
    );
    expect(prismaMock.cajaSession.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.cajaSession.create).not.toHaveBeenCalled();
  });

  it('lanza CAJA_YA_TIENE_SESION_HOY si la caja ya operó hoy', async () => {
    fijarHoy();
    prepararApertura({ sesionHoy: cajaSessionFixture({ status: 'CLOSED' }) });

    await expectApiError(
      () => openCaja('store-1', 'user-1', 'ADMIN', 'caja-1', { openingCash: 100, openingElectronic: 0 }),
      {
        status: 400,
        code: 'CAJA_YA_TIENE_SESION_HOY',
        message: 'Esta caja ya tiene una sesión registrada hoy. Para reabrirla usa el menú Cajas (ADMIN/GERENTE).',
      }
    );
    expect(prismaMock.cajaSession.findFirst).toHaveBeenNthCalledWith(2, {
      where: { cajaId: 'caja-1', storeId: 'store-1', openingDate: '2026-01-15' },
    });
  });

  it('captura el snapshot de inventario cuando la tienda lo tiene activado', async () => {
    fijarHoy();
    prepararApertura({
      store: { aperturaCajaConInventario: true },
      inventario: [
        { productId: 'product-1', quantity: dec('10.000') },
        { productId: 'product-2', quantity: dec('4.000') },
      ],
    });

    await openCaja('store-1', 'user-1', 'ADMIN', 'caja-1', { openingCash: 100, openingElectronic: 0 });

    const datos = prismaMock.cajaSession.create.mock.calls[0]?.[0] as any;
    expect(datos.data.inventoryAdjusted).toBe(true);
    expect(prismaMock.inventorySnapshot.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.inventorySnapshot.upsert).toHaveBeenNthCalledWith(1, {
      where: {
        storeId_productId_date: { storeId: 'store-1', productId: 'product-1', date: INICIO_DIA },
      },
      create: { storeId: 'store-1', productId: 'product-1', date: INICIO_DIA, quantity: dec('10.000') },
      update: { quantity: dec('10.000') },
    });
  });

  it('no ajusta inventario cuando la tienda ya no existe', async () => {
    prepararApertura({ store: null });

    await openCaja('store-1', 'user-1', 'ADMIN', 'caja-1', { openingCash: 100, openingElectronic: 0 });

    const datos = prismaMock.cajaSession.create.mock.calls[0]?.[0] as any;
    expect(datos.data.inventoryAdjusted).toBe(false);
    expect(prismaMock.inventory.findMany).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// calcularCorte
// ───────────────────────────────────────────────────────────────────────────

describe('calcularCorte', () => {
  it('suma ventas, compras y movimientos por método y arma los agregados legacy', async () => {
    mockearCorte({
      ventas: [
        { paymentMethod: 'CASH', _sum: { total: dec('200.00') } },
        { paymentMethod: 'CARD', _sum: { total: dec('50.00') } },
        { paymentMethod: 'TRANSFER', _sum: { total: null } },
        { paymentMethod: 'OTHER', _sum: { total: dec('10.00') } },
      ],
      compras: [
        { paymentMethod: 'CASH', _sum: { total: dec('20.00') } },
        { paymentMethod: 'CARD', _sum: { total: dec('10.00') } },
        { paymentMethod: 'CREDIT', _sum: { total: dec('5.00') } },
      ],
      movimientos: [
        { tipo: 'INGRESO', metodo: 'CASH', monto: dec('30.00') },
        { tipo: 'EGRESO', metodo: 'CASH', monto: dec('10.00') },
        { tipo: 'INGRESO', metodo: 'CARD', monto: dec('5.00') },
        { tipo: 'EGRESO', metodo: 'TRANSFER', monto: dec('2.00') },
        { tipo: 'INGRESO', metodo: 'ELECTRONIC', monto: dec('7.00') },
      ],
    });

    const corte = await calcularCorte(
      { id: 'cajasession-1', openingCash: dec('500.00'), openingElectronic: dec('100.00') },
      'store-1'
    );

    expect(prismaMock.sale.groupBy).toHaveBeenCalledWith({
      by: ['paymentMethod'],
      where: { cajaSessionId: 'cajasession-1', storeId: 'store-1', status: 'COMPLETED' },
      _sum: { total: true },
    });
    expect(prismaMock.supplierTransaction.groupBy).toHaveBeenCalledWith({
      by: ['paymentMethod'],
      where: {
        cajaSessionId: 'cajasession-1',
        storeId: 'store-1',
        status: 'COMPLETED',
        paidFrom: 'CAJA',
      },
      _sum: { total: true },
    });

    expect(corte.salesByMethod).toEqual({ CASH: 200, CARD: 50, TRANSFER: 0, CREDIT: 0, OTHER: 10 });
    expect(corte.purchasesByMethod).toEqual({ CASH: 20, CARD: 10, TRANSFER: 0, CREDIT: 5, OTHER: 0 });
    expect(corte.openingByMethod).toEqual({ CASH: 500, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 100 });
    expect(corte.expectedByMethod).toEqual({ CASH: 700, CARD: 45, TRANSFER: -2, CREDIT: -5, OTHER: 117 });
    expect(corte.movimientosIngresoByMethod).toEqual({
      CASH: 30,
      CARD: 5,
      TRANSFER: 0,
      CREDIT: 0,
      OTHER: 7,
    });
    expect(corte.movimientosEgresoByMethod).toEqual({
      CASH: 10,
      CARD: 0,
      TRANSFER: 2,
      CREDIT: 0,
      OTHER: 0,
    });

    // Legacy: CASH vs. electrónico (CARD, TRANSFER, CREDIT, OTHER).
    expect(Number(corte.salesCash)).toBe(200);
    expect(Number(corte.salesElectronic)).toBe(60);
    expect(Number(corte.purchasesCash)).toBe(20);
    expect(Number(corte.purchasesElectronic)).toBe(15);
    expect(Number(corte.ingresoCash)).toBe(30);
    expect(Number(corte.egresoCash)).toBe(10);
    expect(Number(corte.ingresoElectronic)).toBe(12);
    expect(Number(corte.egresoElectronic)).toBe(2);
    expect(Number(corte.expectedCash)).toBe(700);
    expect(Number(corte.expectedElectronic)).toBe(155);
  });

  it('inicializa todo en cero sin ventas, compras ni movimientos', async () => {
    mockearCorte();

    const corte = await calcularCorte(
      { id: 'cajasession-1', openingCash: 0, openingElectronic: 0 },
      'store-1'
    );

    expect(corte.salesByMethod).toEqual({ CASH: 0, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 });
    expect(corte.expectedByMethod).toEqual({ CASH: 0, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 });
    expect(Number(corte.expectedCash)).toBe(0);
    expect(Number(corte.expectedElectronic)).toBe(0);
  });

  it('ignora los métodos de pago desconocidos que devuelve la base', async () => {
    mockearCorte({
      ventas: [{ paymentMethod: 'BITCOIN', _sum: { total: dec('99.00') } }],
      compras: [{ paymentMethod: 'BITCOIN', _sum: { total: dec('99.00') } }],
    });

    const corte = await calcularCorte(
      { id: 'cajasession-1', openingCash: dec('10.00'), openingElectronic: dec('0.00') },
      'store-1'
    );

    expect(corte.salesByMethod).toEqual({ CASH: 0, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 });
    expect(corte.purchasesByMethod).toEqual({ CASH: 0, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 });
    expect(corte.expectedByMethod).toEqual({ CASH: 10, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// previsualizarCorte
// ───────────────────────────────────────────────────────────────────────────

describe('previsualizarCorte', () => {
  it('devuelve el corte en números sin cerrar la sesión', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionFila());
    mockearCorte({
      ventas: [{ paymentMethod: 'CASH', _sum: { total: dec('120.00') } }],
      compras: [{ paymentMethod: 'CASH', _sum: { total: dec('20.00') } }],
      movimientos: [{ tipo: 'EGRESO', metodo: 'CASH', monto: dec('5.00') }],
    });

    const corte = await previsualizarCorte('cajasession-1', 'store-1');

    expect(prismaMock.cajaSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'cajasession-1', storeId: 'store-1' },
      include: { caja: true },
    });
    expect(corte).toEqual({
      salesByMethod: { CASH: 120, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
      purchasesByMethod: { CASH: 20, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
      openingByMethod: { CASH: 500, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
      expectedByMethod: { CASH: 595, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
      movimientosIngresoByMethod: { CASH: 0, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
      movimientosEgresoByMethod: { CASH: 5, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
      salesCash: 120,
      salesElectronic: 0,
      purchasesCash: 20,
      purchasesElectronic: 0,
      ingresoCash: 0,
      egresoCash: 5,
      ingresoElectronic: 0,
      egresoElectronic: 0,
      expectedCash: 595,
      expectedElectronic: 0,
    });
  });

  it('lanza CAJA_SESSION_NOT_FOUND cuando la sesión no existe', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expectApiError(() => previsualizarCorte('cajasession-9', 'store-1'), {
      status: 404,
      code: 'CAJA_SESSION_NOT_FOUND',
      message: 'Sesión de caja no encontrada',
    });
    expect(prismaMock.sale.groupBy).not.toHaveBeenCalled();
  });

  it('lanza CAJA_YA_CERRADA cuando la sesión ya se cerró', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(
      sesionFila({ status: 'CLOSED', closedAt: HOY })
    );

    await expectApiError(() => previsualizarCorte('cajasession-1', 'store-1'), {
      status: 400,
      code: 'CAJA_YA_CERRADA',
      message: 'La caja ya está cerrada',
    });
    expect(prismaMock.sale.groupBy).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// closeCaja
// ───────────────────────────────────────────────────────────────────────────

interface OpcionesCierre extends OpcionesCorte {
  sesion?: Record<string, unknown> | null;
  cerrada?: Record<string, unknown>;
}

function prepararCierre(opciones: OpcionesCierre = {}): void {
  prismaMock.cajaSession.findFirst.mockResolvedValue(
    opciones.sesion === undefined ? sesionFila() : opciones.sesion
  );
  mockearCorte(opciones);
  prismaMock.cajaSession.update.mockResolvedValue(
    opciones.cerrada ?? { id: 'cajasession-1', status: 'CLOSED', caja: { id: 'caja-1', name: 'Caja 1' } }
  );
}

describe('closeCaja', () => {
  it('cierra la caja como gerente, calcula diferencias por método y audita', async () => {
    fijarHoy();
    prepararCierre({
      ventas: [
        { paymentMethod: 'CASH', _sum: { total: dec('200.00') } },
        { paymentMethod: 'CARD', _sum: { total: dec('50.00') } },
      ],
      compras: [
        { paymentMethod: 'CASH', _sum: { total: dec('20.00') } },
        { paymentMethod: 'CARD', _sum: { total: dec('10.00') } },
      ],
      movimientos: [{ tipo: 'INGRESO', metodo: 'CASH', monto: dec('30.00') }],
    });

    const resultado = await closeCaja('cajasession-1', 'store-1', 'user-1', 'GERENTE', {
      closingAmounts: { CASH: 700, CARD: 40 } as any,
    });

    expect(resultado).toMatchObject({ id: 'cajasession-1', status: 'CLOSED' });

    const datos = prismaMock.cajaSession.update.mock.calls[0]?.[0] as any;
    expect(datos.where).toEqual({ id: 'cajasession-1' });
    expect(datos.data).toMatchObject({
      status: 'CLOSED',
      closedAt: HOY,
      closingDate: '2026-01-15',
      closedBy: 'user-1',
      closingNote: null,
      closingAmounts: { CASH: 700, CARD: 40, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
      expectedAmounts: {
        CASH: 710,
        CARD: 40,
        TRANSFER: 0,
        CREDIT: 0,
        OTHER: 0,
      },
      diffByMethod: { CASH: -10, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
    });
    expect(Number(datos.data.closingCash)).toBe(700);
    expect(Number(datos.data.closingElectronic)).toBe(40);
    expect(Number(datos.data.diffCash)).toBe(-10);
    expect(Number(datos.data.diffElectronic)).toBe(0);
    expect(Number(datos.data.salesCash)).toBe(200);
    expect(Number(datos.data.salesElectronic)).toBe(50);
    expect(Number(datos.data.purchasesCash)).toBe(20);
    expect(Number(datos.data.purchasesElectronic)).toBe(10);
    expect(Number(datos.data.expectedCash)).toBe(710);
    expect(Number(datos.data.expectedElectronic)).toBe(40);

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CLOSE_CAJA',
        entity: 'CajaSession',
        entityId: 'cajasession-1',
        metadata: {
          cajaId: 'caja-1',
          closingByMethod: { CASH: 700, CARD: 40, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
          expectedByMethod: { CASH: 710, CARD: 40, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
          diffByMethod: { CASH: -10, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
        },
      }),
    });
  });

  it('guarda la nota de cierre cuando se envía', async () => {
    prepararCierre();

    await closeCaja('cajasession-1', 'store-1', 'user-1', 'ADMIN', {
      closingAmounts: { CASH: 500 } as any,
      closingNote: 'Cierre con faltante',
    });

    const datos = prismaMock.cajaSession.update.mock.calls[0]?.[0] as any;
    expect(datos.data.closingNote).toBe('Cierre con faltante');
  });

  it('normaliza a cero los montos inválidos o ausentes', async () => {
    prepararCierre({
      sesion: sesionFila({ openingCash: dec('500.00'), openingElectronic: dec('0.00') }),
    });

    await closeCaja('cajasession-1', 'store-1', 'user-1', 'ADMIN', {
      closingAmounts: {
        CASH: NaN,
        CARD: Infinity,
        TRANSFER: '250' as any,
        CREDIT: undefined,
      } as any,
    });

    const datos = prismaMock.cajaSession.update.mock.calls[0]?.[0] as any;
    expect(datos.data.closingAmounts).toEqual({
      CASH: 0,
      CARD: 0,
      TRANSFER: 0,
      CREDIT: 0,
      OTHER: 0,
    });
    expect(datos.data.diffByMethod).toEqual({
      CASH: -500,
      CARD: 0,
      TRANSFER: 0,
      CREDIT: 0,
      OTHER: 0,
    });
  });

  it('lanza CAJA_SESSION_NOT_FOUND cuando la sesión no existe', async () => {
    prepararCierre({ sesion: null });

    await expectApiError(
      () => closeCaja('cajasession-9', 'store-1', 'user-1', 'ADMIN', { closingAmounts: {} as any }),
      { status: 404, code: 'CAJA_SESSION_NOT_FOUND' }
    );
  });

  it('lanza CAJA_YA_CERRADA cuando la sesión ya estaba cerrada', async () => {
    prepararCierre({ sesion: sesionFila({ status: 'CLOSED', closedAt: HOY }) });

    await expectApiError(
      () => closeCaja('cajasession-1', 'store-1', 'user-1', 'ADMIN', { closingAmounts: {} as any }),
      { status: 400, code: 'CAJA_YA_CERRADA', message: 'La caja ya está cerrada' }
    );
    expect(prismaMock.cajaSession.update).not.toHaveBeenCalled();
  });

  it('exige autorización al vendedor', async () => {
    prepararCierre();

    await expectApiError(
      () => closeCaja('cajasession-1', 'store-1', 'user-1', 'VENDEDOR', { closingAmounts: {} as any }),
      {
        status: 403,
        code: 'CLOSE_CAJA_AUTHORIZATION_REQUIRED',
        message: 'Se requiere autorización de un administrador o gerente',
      }
    );
  });

  it('rechaza la autorización de cierre de otra tienda', async () => {
    prepararCierre();

    await expectApiError(
      () =>
        closeCaja('cajasession-1', 'store-1', 'user-1', 'VENDEDOR', {
          closingAmounts: {} as any,
          authorizationToken: tokenCierre({ storeId: 'store-2' }),
        }),
      { status: 403, code: 'CLOSE_CAJA_AUTHORIZATION_INVALID' }
    );
  });

  it('rechaza la autorización de cierre de un vendedor', async () => {
    prepararCierre();

    await expectApiError(
      () =>
        closeCaja('cajasession-1', 'store-1', 'user-1', 'VENDEDOR', {
          closingAmounts: {} as any,
          authorizationToken: tokenCierre({ role: 'VENDEDOR' }),
        }),
      { status: 403, code: 'CLOSE_CAJA_AUTHORIZATION_INVALID' }
    );
  });

  it('rechaza la autorización de cierre con propósito de apertura', async () => {
    prepararCierre();

    await expectApiError(
      () =>
        closeCaja('cajasession-1', 'store-1', 'user-1', 'VENDEDOR', {
          closingAmounts: {} as any,
          authorizationToken: tokenCierre({ purpose: 'OPEN_CAJA' }),
        }),
      {
        status: 403,
        code: 'CLOSE_CAJA_AUTHORIZATION_INVALID',
        message: 'La autorización de cierre no es válida o ya expiró',
      }
    );
  });

  it('permite al vendedor cerrar con autorización válida', async () => {
    prepararCierre();

    const resultado = await closeCaja('cajasession-1', 'store-1', 'user-2', 'VENDEDOR', {
      closingAmounts: { CASH: 500 } as any,
      authorizationToken: tokenCierre(),
    });

    expect(resultado).toMatchObject({ id: 'cajasession-1' });
    const datos = prismaMock.cajaSession.update.mock.calls[0]?.[0] as any;
    expect(datos.data.closedBy).toBe('user-2');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// reopenCaja
// ───────────────────────────────────────────────────────────────────────────

describe('reopenCaja', () => {
  it('prohíbe reabrir la caja al vendedor', async () => {
    await expectApiError(() => reopenCaja('cajasession-1', 'store-1', 'user-1', 'VENDEDOR', 'Error'), {
      status: 403,
      code: 'CAJA_REOPEN_FORBIDDEN',
      message: 'Solo un administrador o gerente puede reabrir la caja',
    });
    expect(prismaMock.cajaSession.findFirst).not.toHaveBeenCalled();
  });

  it('lanza CAJA_SESSION_NOT_FOUND cuando la sesión no existe', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expectApiError(() => reopenCaja('cajasession-9', 'store-1', 'user-1', 'ADMIN', 'Error'), {
      status: 404,
      code: 'CAJA_SESSION_NOT_FOUND',
    });
  });

  it('lanza CAJA_YA_ABIERTA cuando la sesión no está cerrada', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionFila({ status: 'OPEN' }));

    await expectApiError(() => reopenCaja('cajasession-1', 'store-1', 'user-1', 'ADMIN', 'Error'), {
      status: 400,
      code: 'CAJA_YA_ABIERTA',
      message: 'La caja ya está abierta',
    });
  });

  it('lanza CAJA_REOPEN_OTRO_DIA cuando la sesión es de otro día', async () => {
    fijarHoy();
    prismaMock.cajaSession.findFirst.mockResolvedValue(
      sesionFila({ status: 'CLOSED', closedAt: HOY, openingDate: '2026-01-14' })
    );

    await expectApiError(() => reopenCaja('cajasession-1', 'store-1', 'user-1', 'GERENTE', 'Error'), {
      status: 400,
      code: 'CAJA_REOPEN_OTRO_DIA',
      message: 'Solo se puede reabrir una sesión cerrada del día de hoy',
    });
    expect(prismaMock.cajaSession.update).not.toHaveBeenCalled();
  });

  it('reabre la sesión cerrada de hoy, limpia el cierre y audita el motivo', async () => {
    fijarHoy();
    prismaMock.cajaSession.findFirst.mockResolvedValue(
      sesionFila({
        status: 'CLOSED',
        closedAt: HOY,
        closingDate: '2026-01-15',
        closingCash: dec('500.00'),
        closingAmounts: { CASH: 500 },
      })
    );
    prismaMock.cajaSession.update.mockResolvedValue({ id: 'cajasession-1', status: 'OPEN' });

    const resultado = await reopenCaja(
      'cajasession-1',
      'store-1',
      'user-1',
      'GERENTE',
      'Se cobró un ticket después del corte'
    );

    expect(resultado).toMatchObject({ status: 'OPEN' });
    const datos = prismaMock.cajaSession.update.mock.calls[0]?.[0] as any;
    expect(datos.where).toEqual({ id: 'cajasession-1' });
    expect(datos.data).toMatchObject({
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
      reopenedAt: HOY,
      reopenedBy: 'user-1',
      reopenReason: 'Se cobró un ticket después del corte',
    });
    expect(datos.data.closingAmounts).toBe(Prisma.JsonNull);
    expect(datos.data.expectedAmounts).toBe(Prisma.JsonNull);
    expect(datos.data.diffByMethod).toBe(Prisma.JsonNull);

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'REABRIR_CAJA',
        entity: 'CajaSession',
        entityId: 'cajasession-1',
        metadata: { cajaId: 'caja-1', motivo: 'Se cobró un ticket después del corte' },
      }),
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getActiveSession
// ───────────────────────────────────────────────────────────────────────────

describe('getActiveSession', () => {
  it('busca la sesión abierta de la caja asignada al usuario', async () => {
    prismaMock.caja.findFirst.mockResolvedValue({ id: 'caja-9' });
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionFila());

    const resultado = await getActiveSession('store-1', 'user-1');

    expect(resultado).toMatchObject({ id: 'cajasession-1' });
    expect(prismaMock.caja.findFirst).toHaveBeenCalledWith({
      where: { assignedUserId: 'user-1', storeId: 'store-1', isActive: true },
      select: { id: true },
    });
    const args = prismaMock.cajaSession.findFirst.mock.calls[0]?.[0] as any;
    expect(args.where).toEqual({ storeId: 'store-1', status: 'OPEN', cajaId: 'caja-9' });
    expect(args.orderBy).toEqual({ openedAt: 'desc' });
    expect(args.include).toMatchObject({ caja: { select: { id: true, name: true } } });
  });

  it('cae en la sesión donde el usuario es operador cuando no tiene caja', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(null);
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    const resultado = await getActiveSession('store-1', 'user-2');

    expect(resultado).toBeNull();
    const args = prismaMock.cajaSession.findFirst.mock.calls[0]?.[0] as any;
    expect(args.where).toEqual({ storeId: 'store-1', status: 'OPEN', userId: 'user-2' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// resolveCajaSession
// ───────────────────────────────────────────────────────────────────────────

describe('resolveCajaSession', () => {
  it('valida y devuelve la sesión indicada', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(cajaSessionFixture({ id: 'cajasession-1' }));

    const id = await resolveCajaSession(prismaMock as never, 'store-1', 'user-1', 'cajasession-1');

    expect(id).toBe('cajasession-1');
    expect(prismaMock.cajaSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'cajasession-1', storeId: 'store-1', status: 'OPEN' },
    });
  });

  it('lanza CAJA_SESSION_INVALID cuando la sesión indicada no está abierta', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expectApiError(
      () => resolveCajaSession(prismaMock as never, 'store-1', 'user-1', 'cajasession-9'),
      {
        status: 400,
        code: 'CAJA_SESSION_INVALID',
        message: 'La sesión de caja no es válida o no está abierta',
      }
    );
  });

  it('auto-resuelve la sesión abierta del usuario o de su caja', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue({ id: 'cajasession-7' });

    const id = await resolveCajaSession(prismaMock as never, 'store-1', 'user-1');

    expect(id).toBe('cajasession-7');
    expect(prismaMock.cajaSession.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 'store-1',
        status: 'OPEN',
        OR: [{ userId: 'user-1' }, { caja: { assignedUserId: 'user-1' } }],
      },
      orderBy: { openedAt: 'desc' },
    });
  });

  it('lanza CAJA_SESSION_REQUIRED cuando no hay sesión abierta', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expectApiError(
      () => resolveCajaSession(prismaMock as never, 'store-1', 'user-1', null),
      { status: 400, code: 'CAJA_SESSION_REQUIRED', message: 'Debe abrir la caja antes de continuar' }
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// requireOpenSession
// ───────────────────────────────────────────────────────────────────────────

describe('requireOpenSession', () => {
  it('devuelve la sesión cuando está abierta', async () => {
    const fila = cajaSessionFixture({ id: 'cajasession-3' });
    prismaMock.cajaSession.findFirst.mockResolvedValue(fila);

    const resultado = await requireOpenSession(prismaMock as never, 'cajasession-3', 'store-1');

    expect(resultado).toEqual(fila);
    expect(prismaMock.cajaSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'cajasession-3', storeId: 'store-1', status: 'OPEN' },
    });
  });

  it('lanza CAJA_SESSION_INVALID cuando no está abierta', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expectApiError(
      () => requireOpenSession(prismaMock as never, 'cajasession-3', 'store-1'),
      { status: 400, code: 'CAJA_SESSION_INVALID' }
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// findOpenSessionForCaja
// ───────────────────────────────────────────────────────────────────────────

describe('findOpenSessionForCaja', () => {
  it('devuelve la sesión abierta de la caja', async () => {
    const fila = cajaSessionFixture({ id: 'cajasession-5' });
    prismaMock.cajaSession.findFirst.mockResolvedValue(fila);

    const resultado = await findOpenSessionForCaja('store-1', 'caja-1');

    expect(resultado).toEqual(fila);
    expect(prismaMock.cajaSession.findFirst).toHaveBeenCalledWith({
      where: { cajaId: 'caja-1', storeId: 'store-1', status: 'OPEN' },
    });
  });

  it('devuelve null cuando la caja no tiene sesión abierta', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expect(findOpenSessionForCaja('store-1', 'caja-2')).resolves.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// listSessions
// ───────────────────────────────────────────────────────────────────────────

describe('listSessions', () => {
  it('sin filtros consulta todas las sesiones de la tienda', async () => {
    const filas = [sesionFila()];
    prismaMock.cajaSession.findMany.mockResolvedValue(filas);

    const resultado = await listSessions('store-1');

    expect(resultado).toEqual(filas);
    const args = prismaMock.cajaSession.findMany.mock.calls[0]?.[0] as any;
    expect(args.where).toEqual({ storeId: 'store-1' });
    expect(args.orderBy).toEqual({ openedAt: 'desc' });
    expect(args.include).toMatchObject({
      caja: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    });
  });

  it('aplica los filtros de caja y estatus', async () => {
    prismaMock.cajaSession.findMany.mockResolvedValue([]);

    await listSessions('store-1', { cajaId: 'caja-1', status: 'CLOSED' });

    const args = prismaMock.cajaSession.findMany.mock.calls[0]?.[0] as any;
    expect(args.where).toEqual({ storeId: 'store-1', cajaId: 'caja-1', status: 'CLOSED' });
  });

  it('filtra desde la fecha inicial', async () => {
    prismaMock.cajaSession.findMany.mockResolvedValue([]);

    await listSessions('store-1', { startDate: '2026-01-01' });

    const args = prismaMock.cajaSession.findMany.mock.calls[0]?.[0] as any;
    expect(args.where.openingDate).toEqual({ gte: '2026-01-01' });
  });

  it('filtra hasta la fecha final', async () => {
    prismaMock.cajaSession.findMany.mockResolvedValue([]);

    await listSessions('store-1', { endDate: '2026-01-31' });

    const args = prismaMock.cajaSession.findMany.mock.calls[0]?.[0] as any;
    expect(args.where.openingDate).toEqual({ lte: '2026-01-31' });
  });

  it('filtra por un rango completo de fechas', async () => {
    prismaMock.cajaSession.findMany.mockResolvedValue([]);

    await listSessions('store-1', { startDate: '2026-01-01', endDate: '2026-01-31' });

    const args = prismaMock.cajaSession.findMany.mock.calls[0]?.[0] as any;
    expect(args.where.openingDate).toEqual({ gte: '2026-01-01', lte: '2026-01-31' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getSessionReport
// ───────────────────────────────────────────────────────────────────────────

interface OpcionesReporte {
  sesion?: Record<string, unknown> | null;
  inventarios?: Record<string, unknown>[];
  snapshots?: Record<string, unknown>[];
  ventas?: Record<string, unknown>[];
  compras?: Record<string, unknown>[];
  movimientos?: Record<string, unknown>[];
  itemsVenta?: Record<string, unknown>[];
  movimientosCaja?: Record<string, unknown>[];
  motivos?: Record<string, unknown>[];
}

function prepararReporte(opciones: OpcionesReporte = {}): void {
  prismaMock.cajaSession.findFirst.mockResolvedValue(
    opciones.sesion === undefined ? sesionFila() : opciones.sesion
  );
  prismaMock.sale.findMany.mockResolvedValue(opciones.ventas ?? []);
  prismaMock.supplierTransaction.findMany.mockResolvedValue(opciones.compras ?? []);
  prismaMock.inventory.findMany.mockResolvedValue(opciones.inventarios ?? []);
  prismaMock.inventorySnapshot.findMany.mockResolvedValue(opciones.snapshots ?? []);
  prismaMock.saleItem.findMany.mockResolvedValue(opciones.itemsVenta ?? []);
  prismaMock.stockMovement.findMany.mockResolvedValue(opciones.movimientos ?? []);
  mockearCorte({ movimientos: opciones.movimientosCaja as any });

  // `resumenPorMotivo` pide `motivoId` en el select; las otras dos consultas no.
  const planos = opciones.movimientosCaja ?? [];
  const motivos = opciones.motivos ?? [];
  prismaMock.cajaMovimiento.findMany.mockImplementation(async (args: any) =>
    args?.select?.motivoId ? motivos : planos
  );
}

describe('getSessionReport', () => {
  it('reconstruye el inventario del turno y desglosa la pérdida por motivo', async () => {
    fijarHoy();
    prepararReporte({
      inventarios: [
        {
          productId: 'product-1',
          quantity: dec('5.000'),
          product: { id: 'product-1', name: 'Refresco 600ml', unidadVenta: 'UNIDAD' },
        },
        {
          productId: 'product-2',
          quantity: dec('8.000'),
          product: { id: 'product-2', name: 'Sabritas', unidadVenta: 'UNIDAD' },
        },
      ],
      snapshots: [{ productId: 'product-1', quantity: dec('10.000') }],
      ventas: [
        {
          id: 'sale-1',
          saleNumber: 'STORE001-0001',
          total: dec('120.00'),
          paymentMethod: 'CASH',
          status: 'COMPLETED',
          createdAt: HOY,
        },
      ],
      itemsVenta: [
        { productId: 'product-1', quantity: dec('2.000') },
        { productId: 'product-1', quantity: dec('1.000') },
      ],
      compras: [
        {
          id: 'stx-1',
          reference: 'COMPRA-0001',
          total: dec('20.00'),
          paymentMethod: 'CASH',
          paidFrom: 'CAJA',
          status: 'COMPLETED',
          createdAt: HOY,
        },
      ],
      movimientos: [
        { productId: 'product-2', tipo: 'ENTRADA', quantity: dec('5.000') },
        { productId: 'product-1', tipo: 'ENTRADA', quantity: dec('4.000') },
        { productId: 'product-1', tipo: 'SALIDA', quantity: dec('2.000') },
      ],
      movimientosCaja: [
        { tipo: 'INGRESO', metodo: 'CASH', monto: dec('30.00') },
        { tipo: 'EGRESO', metodo: 'CARD', monto: dec('5.00') },
      ],
      motivos: [
        {
          tipo: 'INGRESO',
          metodo: 'CASH',
          monto: dec('30.00'),
          motivoId: null,
          motivoTexto: 'Feria',
          motivo: null,
        },
      ],
    });

    const reporte = await getSessionReport('cajasession-1', 'store-1');

    expect(prismaMock.cajaSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'cajasession-1', storeId: 'store-1' },
      include: {
        caja: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });
    expect(prismaMock.inventorySnapshot.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', date: INICIO_DIA },
    });
    // Sesión abierta: el rango llega hasta "ahora".
    const argsMovimientos = prismaMock.stockMovement.findMany.mock.calls[0]?.[0] as any;
    expect(argsMovimientos.where.createdAt).toEqual({ gte: INICIO_DIA, lte: HOY });

    expect(reporte.sales).toEqual([
      expect.objectContaining({ id: 'sale-1', saleNumber: 'STORE001-0001', total: 120 }),
    ]);
    expect(reporte.purchases).toEqual([
      expect.objectContaining({ id: 'stx-1', reference: 'COMPRA-0001', total: 20 }),
    ]);
    expect(reporte.closingAmounts).toBeNull();
    expect(reporte.expectedByMethod).toBeNull();
    expect(reporte.diffByMethod).toBeNull();
    expect(reporte.inventoryAdjusted).toBe(false);
    expect(reporte.movimientos).toEqual({
      ingresoCash: 30,
      egresoCash: 0,
      ingresoElectronic: 0,
      egresoElectronic: 5,
      ingresoByMethod: { CASH: 30, CARD: 0, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
      egresoByMethod: { CASH: 0, CARD: 5, TRANSFER: 0, CREDIT: 0, OTHER: 0 },
    });
    expect(reporte.movimientosPorMotivo).toEqual([
      {
        motivoId: null,
        motivoName: 'Otro (texto libre)',
        motivoTexto: 'Feria',
        tipo: 'INGRESO',
        metodo: 'CASH',
        total: 30,
        cantidad: 1,
      },
    ]);
    expect(reporte.inventory).toEqual([
      {
        productId: 'product-1',
        productName: 'Refresco 600ml',
        unidadVenta: 'UNIDAD',
        initial: 10,
        ventas: 3,
        entradas: 4,
        salidas: 2,
        final: 5,
      },
      {
        productId: 'product-2',
        productName: 'Sabritas',
        unidadVenta: 'UNIDAD',
        initial: 3,
        ventas: 0,
        entradas: 5,
        salidas: 0,
        final: 8,
      },
    ]);
  });

  it('usa la fecha de cierre como tope y deserializa los montos del corte', async () => {
    fijarHoy();
    const cierre = new Date('2026-01-15T23:00:00.000Z');
    prepararReporte({
      sesion: sesionFila({
        status: 'CLOSED',
        closedAt: cierre,
        inventoryAdjusted: true,
        closingAmounts: { CASH: 700, CARD: 40 },
        expectedAmounts: { CASH: 710, CARD: 40 },
        diffByMethod: { CASH: -10, CARD: 0 },
      }),
    });

    const reporte = await getSessionReport('cajasession-1', 'store-1');

    const argsMovimientos = prismaMock.stockMovement.findMany.mock.calls[0]?.[0] as any;
    expect(argsMovimientos.where.createdAt).toEqual({ gte: INICIO_DIA, lte: cierre });
    expect(reporte.closingAmounts).toEqual({ CASH: 700, CARD: 40 });
    expect(reporte.expectedByMethod).toEqual({ CASH: 710, CARD: 40 });
    expect(reporte.diffByMethod).toEqual({ CASH: -10, CARD: 0 });
    expect(reporte.inventoryAdjusted).toBe(true);
    expect(reporte.inventory).toEqual([]);
  });

  it('lanza CAJA_SESSION_NOT_FOUND cuando la sesión no existe', async () => {
    prepararReporte({ sesion: null });

    await expectApiError(() => getSessionReport('cajasession-9', 'store-1'), {
      status: 404,
      code: 'CAJA_SESSION_NOT_FOUND',
    });
    expect(prismaMock.sale.findMany).not.toHaveBeenCalled();
  });
});
