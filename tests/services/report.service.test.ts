import { afterEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import {
  cajaSessionFixture,
  dec,
  productFixture,
  saleFixture,
  saleItemFixture,
  storeFixture,
} from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import {
  cierreCaja,
  corteCaja,
  dailyReport,
  monthlyReport,
  productsReport,
  profitMarginByCategory,
  suppliersReport,
} from '../../src/services/report.service';
import { mexicoEndOfDay, mexicoStartOfDay } from '../../src/utils/dates';

// En el "día de negocio" (America/Mazatlan, UTC-7) las 18:00Z son las 11:00
// del mismo día: sirve para que la fecha local coincida con la UTC.
const TARDE = new Date('2026-01-15T18:00:00.000Z');
const STORE = 'store-1';

/** Tienda existente; `controlCajas` decide la rama de corte de caja. */
function mockTienda(controlCajas = false): void {
  prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: STORE, controlCajas }));
}

/** Sin cancelaciones parciales ni listado de cancelaciones. */
function mockSinCancelaciones(): void {
  prismaMock.cancellation.findMany.mockResolvedValue([]);
}

/**
 * getInventoryReport (importado de stockMovement.service) se ejecuta de verdad
 * dentro de corteCaja: sus consultas se dejan vacías para no acoplarse a él.
 */
function mockInventarioVacio(): void {
  prismaMock.inventory.findMany.mockResolvedValue([]);
  prismaMock.inventorySnapshot.findMany.mockResolvedValue([]);
  prismaMock.stockMovement.findMany.mockResolvedValue([]);
}

/** Fila de venta con la forma que devuelve `include: saleInclude`. */
function ventaRow(over: Record<string, any> = {}): Record<string, any> {
  return {
    ...saleFixture({ id: 'sale-1', createdAt: TARDE, ...over } as any),
    items: [],
    user: { id: 'user-1', name: 'Vendedor Uno' },
    ...over,
  };
}

/** Línea de venta con su producto incluido. */
function itemRow(over: Record<string, any> = {}): Record<string, any> {
  return {
    ...saleItemFixture(over as any),
    product: productFixture({ id: 'product-1', name: 'Refresco 600ml', unidadVenta: 'UNIDAD' }),
    ...over,
  };
}

/** Argumento de la n-ésima llamada a un mock de Prisma. */
function argsDe(fn: any, indice = 0): any {
  return fn.mock.calls[indice]?.[0];
}

afterEach(() => {
  vi.useRealTimers();
});

describe('dailyReport', () => {
  it('lanza STORE_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => dailyReport(STORE, '2026-01-15'), {
      status: 404,
      code: 'STORE_NOT_FOUND',
      message: 'Tienda no encontrada',
    });
    expect(prismaMock.sale.findMany).not.toHaveBeenCalled();
  });

  it('suma ventas y ganancias del día y agrupa por método de pago', async () => {
    mockTienda();
    prismaMock.sale.findMany.mockResolvedValue([
      ventaRow({ id: 'sale-1', total: dec('100.00'), profit: dec('30.00'), paymentMethod: 'CASH' }),
      ventaRow({ id: 'sale-2', total: dec('50.00'), profit: dec('10.00'), paymentMethod: 'CASH' }),
      ventaRow({ id: 'sale-3', total: dec('25.00'), profit: dec('5.00'), paymentMethod: 'CARD' }),
    ]);
    mockSinCancelaciones();

    const resultado = await dailyReport(STORE, '2026-01-15');

    expect(resultado).toEqual({
      storeId: STORE,
      date: '2026-01-15',
      salesCount: 3,
      totalRevenue: 175,
      totalProfit: 45,
      profitMargin: (45 / 175) * 100,
      averageTicket: 175 / 3,
      salesByPayment: { CASH: 150, CARD: 25 },
    });
    expect(prismaMock.sale.findMany).toHaveBeenCalledWith({
      where: {
        storeId: STORE,
        status: 'COMPLETED',
        createdAt: { gte: mexicoStartOfDay('2026-01-15'), lte: mexicoEndOfDay('2026-01-15') },
      },
      select: { id: true, total: true, profit: true, paymentMethod: true, createdAt: true },
    });
  });

  it('resta las cancelaciones parciales del ingreso y de la ganancia', async () => {
    mockTienda();
    prismaMock.sale.findMany.mockResolvedValue([
      ventaRow({ id: 'sale-1', total: dec('100.00'), profit: dec('30.00') }),
    ]);
    prismaMock.cancellation.findMany.mockResolvedValue([
      { entityId: 'sale-1', total: dec('40.00'), items: [{ profit: dec('10.00') }] },
      { entityId: 'sale-1', total: dec('10.00'), items: [{ profit: dec('5.00') }] },
    ]);

    const resultado = await dailyReport(STORE, '2026-01-15');

    expect(resultado.totalRevenue).toBe(50);
    expect(resultado.totalProfit).toBe(15);
    expect(resultado.profitMargin).toBe(30);
    expect(resultado.averageTicket).toBe(50);
    expect(argsDe(prismaMock.cancellation.findMany).where).toEqual({
      storeId: STORE,
      entityType: 'SALE',
      type: 'PARTIAL',
      createdAt: { gte: mexicoStartOfDay('2026-01-15'), lte: mexicoEndOfDay('2026-01-15') },
    });
  });

  it('ancla en cero el ingreso y la ganancia si las cancelaciones los superan', async () => {
    mockTienda();
    prismaMock.sale.findMany.mockResolvedValue([
      ventaRow({ id: 'sale-1', total: dec('100.00'), profit: dec('30.00') }),
    ]);
    prismaMock.cancellation.findMany.mockResolvedValue([
      { entityId: 'sale-1', total: dec('500.00'), items: [{ profit: dec('100.00') }] },
    ]);

    const resultado = await dailyReport(STORE, '2026-01-15');

    expect(resultado.totalRevenue).toBe(0);
    expect(resultado.totalProfit).toBe(0);
    expect(resultado.profitMargin).toBe(0);
    expect(resultado.averageTicket).toBe(0);
  });

  it('devuelve ceros cuando no hay ventas', async () => {
    mockTienda();
    prismaMock.sale.findMany.mockResolvedValue([]);
    mockSinCancelaciones();

    const resultado = await dailyReport(STORE, '2026-01-15');

    expect(resultado).toEqual({
      storeId: STORE,
      date: '2026-01-15',
      salesCount: 0,
      totalRevenue: 0,
      totalProfit: 0,
      profitMargin: 0,
      averageTicket: 0,
      salesByPayment: {},
    });
  });

  it('usa el día de negocio actual cuando no se indica fecha', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'));
    mockTienda();
    prismaMock.sale.findMany.mockResolvedValue([]);
    mockSinCancelaciones();

    const resultado = await dailyReport(STORE);

    expect(resultado.date).toBe('2026-03-15');
    expect(argsDe(prismaMock.sale.findMany).where.createdAt).toEqual({
      gte: mexicoStartOfDay('2026-03-15'),
      lte: mexicoEndOfDay('2026-03-15'),
    });
  });
});

describe('monthlyReport', () => {
  it('lanza STORE_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => monthlyReport(STORE, '2026-01'), {
      status: 404,
      code: 'STORE_NOT_FOUND',
    });
    expect(prismaMock.sale.findMany).not.toHaveBeenCalled();
  });

  it('agrupa por día de negocio, resta cancelaciones y ordena por fecha', async () => {
    mockTienda();
    // Deliberadamente desordenadas: el servicio ordena por día.
    prismaMock.sale.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-16T18:00:00.000Z'), total: dec('200.00'), profit: dec('60.00') },
      { createdAt: new Date('2026-01-15T18:00:00.000Z'), total: dec('100.00'), profit: dec('30.00') },
      { createdAt: new Date('2026-01-15T20:00:00.000Z'), total: dec('50.00'), profit: dec('10.00') },
    ]);
    prismaMock.cancellation.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-15T21:00:00.000Z'), total: dec('60.00'), items: [{ profit: dec('10.00') }] },
      // Día sin ventas: la cancelación se ignora (no crea fila).
      { createdAt: new Date('2026-01-20T18:00:00.000Z'), total: dec('99.00'), items: [{ profit: dec('9.00') }] },
    ]);

    const resultado = await monthlyReport(STORE, '2026-01');

    expect(resultado).toEqual([
      {
        month: '2026-01-15',
        totalRevenue: 90,
        totalProfit: 30,
        profitMargin: (30 / 90) * 100,
        salesCount: 2,
      },
      {
        month: '2026-01-16',
        totalRevenue: 200,
        totalProfit: 60,
        profitMargin: 30,
        salesCount: 1,
      },
    ]);
    expect(argsDe(prismaMock.sale.findMany).where).toEqual({
      storeId: STORE,
      status: 'COMPLETED',
      createdAt: { gte: mexicoStartOfDay('2026-01-01'), lte: mexicoEndOfDay('2026-01-31') },
    });
    expect(argsDe(prismaMock.cancellation.findMany).where).toEqual({
      storeId: STORE,
      entityType: 'SALE',
      type: 'PARTIAL',
      createdAt: { gte: mexicoStartOfDay('2026-01-01'), lte: mexicoEndOfDay('2026-01-31') },
    });
  });

  it('ancla en cero el ingreso y la ganancia del día tras cancelaciones grandes', async () => {
    mockTienda();
    prismaMock.sale.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-10T18:00:00.000Z'), total: dec('50.00'), profit: dec('10.00') },
    ]);
    prismaMock.cancellation.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-10T19:00:00.000Z'), total: dec('80.00'), items: [{ profit: dec('20.00') }] },
    ]);

    const resultado = await monthlyReport(STORE, '2026-01');

    expect(resultado).toEqual([
      { month: '2026-01-10', totalRevenue: 0, totalProfit: 0, profitMargin: 0, salesCount: 1 },
    ]);
  });

  it('devuelve un arreglo vacío cuando el mes no tiene ventas', async () => {
    mockTienda();
    prismaMock.sale.findMany.mockResolvedValue([]);
    mockSinCancelaciones();

    await expect(monthlyReport(STORE, '2026-04')).resolves.toEqual([]);
  });

  it('calcula el último día de febrero en año bisiesto y no bisiesto', async () => {
    mockTienda();
    prismaMock.sale.findMany.mockResolvedValue([]);
    mockSinCancelaciones();

    await monthlyReport(STORE, '2024-02');
    expect(argsDe(prismaMock.sale.findMany).where.createdAt.lte).toEqual(
      mexicoEndOfDay('2024-02-29')
    );

    await monthlyReport(STORE, '2026-02');
    expect(argsDe(prismaMock.sale.findMany, 1).where.createdAt.lte).toEqual(
      mexicoEndOfDay('2026-02-28')
    );
  });

  it('usa el mes actual cuando no se indica', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    mockTienda();
    prismaMock.sale.findMany.mockResolvedValue([]);
    mockSinCancelaciones();

    const resultado = await monthlyReport(STORE);

    expect(resultado).toEqual([]);
    expect(argsDe(prismaMock.sale.findMany).where.createdAt).toEqual({
      gte: mexicoStartOfDay('2026-05-01'),
      lte: mexicoEndOfDay('2026-05-31'),
    });
  });

  it('lanza INVALID_DATE si el mes no tiene el formato YYYY-MM', async () => {
    mockTienda();

    await expectApiError(() => monthlyReport(STORE, 'enero'), {
      status: 400,
      code: 'INVALID_DATE',
      message: 'Mes inválido',
    });
    expect(prismaMock.sale.findMany).not.toHaveBeenCalled();
  });

  it('lanza INVALID_DATE si el mes es mayor a 12', async () => {
    mockTienda();

    await expectApiError(() => monthlyReport(STORE, '2026-13'), {
      status: 400,
      code: 'INVALID_DATE',
      message: 'Mes inválido',
    });
  });

  it('lanza INVALID_DATE si el mes es 00', async () => {
    mockTienda();

    await expectApiError(() => monthlyReport(STORE, '2026-00'), {
      status: 400,
      code: 'INVALID_DATE',
      message: 'Mes inválido',
    });
  });
});

describe('corteCaja', () => {
  it('lanza STORE_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => corteCaja(STORE, '2026-01-15'), {
      status: 404,
      code: 'STORE_NOT_FOUND',
    });
    expect(prismaMock.sale.findMany).not.toHaveBeenCalled();
  });

  it('calcula el corte de un día sin control de cajas', async () => {
    mockTienda(false);
    prismaMock.sale.findMany.mockResolvedValue([
      ventaRow({
        id: 'sale-1',
        total: dec('100.00'),
        discount: dec('10.00'),
        profit: dec('30.00'),
        paymentMethod: 'CASH',
        items: [itemRow({ quantity: dec('2.000'), unitPrice: dec('50.00') })],
      }),
      ventaRow({
        id: 'sale-2',
        total: dec('50.00'),
        discount: dec('0.00'),
        profit: dec('20.00'),
        paymentMethod: 'CARD',
      }),
    ]);
    prismaMock.cancellation.findMany
      .mockResolvedValueOnce([
        { entityId: 'sale-1', total: dec('20.00'), items: [{ profit: dec('5.00') }] },
      ])
      .mockResolvedValueOnce([]);
    mockInventarioVacio();

    const resultado = await corteCaja(STORE, '2026-01-15');

    expect(resultado.controlCajas).toBe(false);
    expect(typeof resultado.generatedAt).toBe('string');
    expect(resultado.salesCount).toBe(2);
    expect(resultado.totalRevenue).toBe(150);
    expect(resultado.totalDiscount).toBe(10);
    expect(resultado.totalProfit).toBe(45);
    // Efectivo esperado = vendido bruto - cancelaciones parciales (20).
    expect(resultado.cashExpected).toBe(130);
    expect(resultado.averageTicket).toBe(75);
    expect(resultado.date).toBe('2026-01-15');
    expect(resultado.salesByPayment).toEqual({
      CASH: { count: 1, total: 80 },
      CARD: { count: 1, total: 50 },
    });
    expect(resultado.sales).toEqual([
      {
        id: 'sale-1',
        saleNumber: 'STORE001-0001',
        createdAt: TARDE.toISOString(),
        userId: 'user-1',
        userName: 'Vendedor Uno',
        total: 80,
        discount: 10,
        paymentMethod: 'CASH',
        status: 'COMPLETED',
        items: [{ productName: 'Refresco 600ml', quantity: 2, unitPrice: 50, unidad: 'UNIDAD' }],
      },
      {
        id: 'sale-2',
        saleNumber: 'STORE001-0001',
        createdAt: TARDE.toISOString(),
        userId: 'user-1',
        userName: 'Vendedor Uno',
        total: 50,
        discount: 0,
        paymentMethod: 'CARD',
        status: 'COMPLETED',
        items: [],
      },
    ]);
    // Día único: desglose por hora con las 24 horas del día.
    expect(resultado.byHour).toHaveLength(24);
    const hora = TARDE.getHours();
    expect(resultado.byHour[hora]).toEqual({ hour: hora, count: 2, totalRevenue: 130 });
    expect(resultado.byHour.reduce((acumulado, e) => acumulado + e.count, 0)).toBe(2);
    expect(resultado.byDay).toEqual([]);
    expect(resultado.cajas).toEqual([]);
    expect(resultado.aperturaEfectivo).toBe(0);
    expect(resultado.aperturaElectronico).toBe(0);
    expect(resultado.movimientosEfectivoIngreso).toBe(0);
    expect(resultado.movimientosEfectivoEgreso).toBe(0);
    expect(resultado.comprasCajaEfectivo).toBe(0);
    expect(resultado.totalExpectedByMethod).toEqual({
      CASH: 0,
      CARD: 0,
      TRANSFER: 0,
      CREDIT: 0,
      OTHER: 0,
    });
    expect(resultado.movimientosPorMotivo).toEqual([]);
    expect(resultado.inventario.byProduct).toEqual([]);
    // Sin control de cajas no se consultan sesiones, movimientos ni compras.
    expect(prismaMock.cajaSession.findMany).not.toHaveBeenCalled();
    expect(prismaMock.cajaMovimiento.findMany).not.toHaveBeenCalled();
    expect(prismaMock.supplierTransaction.findMany).not.toHaveBeenCalled();
    // La segunda consulta de ventas es la del reporte de inventario (misma fecha).
    expect(argsDe(prismaMock.sale.findMany, 1).where.createdAt).toEqual({
      gte: mexicoStartOfDay('2026-01-15'),
      lte: mexicoEndOfDay('2026-01-15'),
    });
  });

  it('filtra por operador y rango de fechas y devuelve el desglose por día', async () => {
    mockTienda(false);
    prismaMock.sale.findMany.mockResolvedValue([
      ventaRow({
        id: 'sale-1',
        total: dec('100.00'),
        profit: dec('30.00'),
        userId: 'user-2',
        createdAt: new Date('2026-01-10T18:00:00.000Z'),
      }),
      ventaRow({
        id: 'sale-2',
        total: dec('40.00'),
        profit: dec('10.00'),
        userId: 'user-2',
        createdAt: new Date('2026-01-11T18:00:00.000Z'),
      }),
      ventaRow({
        id: 'sale-3',
        total: dec('10.00'),
        profit: dec('2.00'),
        userId: 'user-2',
        createdAt: new Date('2026-01-11T19:00:00.000Z'),
      }),
    ]);
    prismaMock.cancellation.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'canc-1',
        entityType: 'SALE',
        entityId: 'sale-1',
        entityNumber: 'STORE001-0001',
        type: 'PARTIAL',
        total: dec('10.00'),
        comment: 'nota de cancelación',
        createdAt: new Date('2026-01-10T20:00:00.000Z'),
        userId: 'user-2',
        user: { id: 'user-2', name: 'Cajero Dos' },
        cancellationReason: { name: 'Duplicada' },
      },
      {
        id: 'canc-2',
        entityType: 'SALE',
        entityId: 'sale-2',
        entityNumber: 'STORE001-0002',
        type: 'FULL',
        total: dec('20.00'),
        comment: null,
        createdAt: new Date('2026-01-11T20:00:00.000Z'),
        userId: 'user-1',
        user: null,
        cancellationReason: null,
      },
    ]);
    mockInventarioVacio();

    const resultado = await corteCaja(STORE, undefined, '2026-01-01', '2026-01-31', 'user-2');

    expect(argsDe(prismaMock.sale.findMany).where).toEqual({
      storeId: STORE,
      status: 'COMPLETED',
      userId: 'user-2',
      createdAt: { gte: mexicoStartOfDay('2026-01-01'), lte: mexicoEndOfDay('2026-01-31') },
    });
    expect(argsDe(prismaMock.sale.findMany).orderBy).toEqual({ createdAt: 'desc' });
    expect(resultado.date).toBe('2026-01-01');
    expect(resultado.cancelledCount).toBe(2);
    expect(resultado.cancelledAmount).toBe(30);
    expect(resultado.partialCancelledCount).toBe(1);
    expect(resultado.cancelledCountByOperator).toBe(1);
    expect(resultado.cancellations).toEqual([
      {
        id: 'canc-1',
        entityType: 'SALE',
        entityId: 'sale-1',
        entityNumber: 'STORE001-0001',
        type: 'PARTIAL',
        total: 10,
        reason: 'Duplicada',
        comment: 'nota de cancelación',
        createdAt: '2026-01-10T20:00:00.000Z',
        userName: 'Cajero Dos',
        items: [],
      },
      {
        id: 'canc-2',
        entityType: 'SALE',
        entityId: 'sale-2',
        entityNumber: 'STORE001-0002',
        type: 'FULL',
        total: 20,
        reason: '—',
        comment: null,
        createdAt: '2026-01-11T20:00:00.000Z',
        userName: '—',
        items: [],
      },
    ]);
    expect(argsDe(prismaMock.cancellation.findMany, 1).orderBy).toEqual({ createdAt: 'desc' });
    // Rango de varios días: desglose por día ordenado.
    expect(resultado.byDay).toEqual([
      { date: '2026-01-10', count: 1, totalRevenue: 100 },
      { date: '2026-01-11', count: 2, totalRevenue: 50 },
    ]);
    expect(resultado.byHour).toEqual([]);
  });

  it('usa valores por defecto en el detalle y ancla el neto de la venta en cero', async () => {
    mockTienda(false);
    prismaMock.sale.findMany.mockResolvedValue([
      ventaRow({
        id: 'sale-1',
        total: dec('20.00'),
        profit: dec('5.00'),
        user: null,
        items: [{ ...itemRow(), product: null }],
      }),
      ventaRow({ id: 'sale-2', total: dec('30.00'), profit: dec('10.00'), items: [] }),
    ]);
    prismaMock.cancellation.findMany
      // La cancelación parcial supera el total de la venta.
      .mockResolvedValueOnce([{ entityId: 'sale-1', total: dec('99.00'), items: [] }])
      .mockResolvedValueOnce([]);
    mockInventarioVacio();

    const resultado = await corteCaja(STORE, '2026-01-15');

    expect(resultado.sales[0]).toMatchObject({
      userName: '—',
      total: 0,
      items: [{ productName: 'Producto', unidad: null }],
    });
    // El conteo por método suma las dos ventas aunque una quede en cero.
    expect(resultado.salesByPayment).toEqual({ CASH: { count: 2, total: 30 } });
    expect(resultado.cashExpected).toBe(0);
  });

  it('con control de cajas suma sesiones, movimientos y compras en efectivo', async () => {
    mockTienda(true);
    prismaMock.sale.findMany.mockResolvedValue([
      ventaRow({ id: 'sale-1', total: dec('100.00'), profit: dec('30.00'), paymentMethod: 'CASH' }),
    ]);
    prismaMock.cancellation.findMany.mockResolvedValue([]);
    mockInventarioVacio();

    const sesionCerrada = {
      ...cajaSessionFixture({
        id: 'cs-1',
        status: 'CLOSED',
        closingAmounts: { CASH: 450 },
        expectedAmounts: { CASH: 500, CARD: 100 },
        diffByMethod: { CASH: -50 },
      }),
      caja: { id: 'caja-1', name: 'Caja 1' },
      user: { id: 'user-1', name: 'Vendedor Uno' },
      movimientosPorMotivo: [
        { motivoName: 'Venta', tipo: 'INGRESO', metodo: 'CASH', total: 200, cantidad: 2 },
      ],
    };
    const sesionSinDetalle = {
      ...cajaSessionFixture({ id: 'cs-2' }),
      caja: null,
      user: null,
      closingAmounts: null,
      expectedAmounts: null,
      diffByMethod: null,
      movimientosPorMotivo: null,
    };
    prismaMock.cajaSession.findMany
      // 1ª llamada: sesiones del cierre de caja; 2ª: apertura de efectivo.
      .mockResolvedValueOnce([sesionCerrada, sesionSinDetalle])
      .mockResolvedValueOnce([
        { openingCash: dec('500.00'), openingElectronic: dec('100.00') },
      ]);
    prismaMock.cajaMovimiento.groupBy.mockResolvedValue([
      { cajaSessionId: 'cs-1', tipo: 'INGRESO', metodo: 'CASH', _sum: { monto: dec('200.00') } },
      { cajaSessionId: 'cs-1', tipo: 'EGRESO', metodo: 'CASH', _sum: { monto: dec('50.00') } },
      { cajaSessionId: 'cs-1', tipo: 'INGRESO', metodo: 'CARD', _sum: { monto: null } },
    ]);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        cajaSessionId: 'cs-1',
        tipo: 'INGRESO',
        metodo: 'CASH',
        motivoId: 'motivo-1',
        motivoTexto: null,
        motivoName: 'Venta',
        total: dec('200.00'),
        cantidad: 2n,
      },
      {
        cajaSessionId: 'cs-1',
        tipo: 'EGRESO',
        metodo: 'CASH',
        motivoId: null,
        motivoTexto: 'Compra de hielo',
        motivoName: null,
        total: dec('50.00'),
        cantidad: 1n,
      },
    ]);
    prismaMock.cajaMovimiento.findMany.mockResolvedValue([
      { tipo: 'INGRESO', metodo: 'CASH', monto: dec('100.00') },
      { tipo: 'EGRESO', metodo: 'CASH', monto: dec('40.00') },
      { tipo: 'INGRESO', metodo: 'CARD', monto: dec('999.00') },
      { tipo: 'AJUSTE', metodo: 'CASH', monto: dec('7.00') },
    ]);
    prismaMock.supplierTransaction.findMany.mockResolvedValue([{ total: dec('30.00') }]);

    const resultado = await corteCaja(STORE, '2026-01-15');

    expect(resultado.controlCajas).toBe(true);
    expect(resultado.cajas).toHaveLength(2);
    expect(resultado.cajas[0]).toMatchObject({
      id: 'cs-1',
      caja: 'Caja 1',
      cajero: 'Vendedor Uno',
      expectedByMethod: { CASH: 500, CARD: 100 },
      // El detalle de la fila viene del SQL agrupado, no del fixture.
      movimientosPorMotivo: [
        { motivoName: 'Venta', tipo: 'INGRESO', metodo: 'CASH', total: 200, cantidad: 2 },
        { motivoName: 'Sin motivo', tipo: 'EGRESO', metodo: 'CASH', total: 50, cantidad: 1 },
      ],
    });
    expect(resultado.cajas[1]).toMatchObject({
      id: 'cs-2',
      caja: 'Caja',
      cajero: '—',
      expectedByMethod: null,
      movimientosPorMotivo: [],
    });
    expect(resultado.aperturaEfectivo).toBe(500);
    expect(resultado.aperturaElectronico).toBe(100);
    // Solo los movimientos/métodos CASH afectan el cajón; "AJUSTE" se ignora.
    expect(resultado.movimientosEfectivoIngreso).toBe(100);
    expect(resultado.movimientosEfectivoEgreso).toBe(40);
    expect(resultado.comprasCajaEfectivo).toBe(30);
    // 500 apertura + 100 ventas efectivo + 100 ingresos - 40 egresos - 30 compras
    expect(resultado.cashExpected).toBe(630);
    expect(resultado.totalExpectedByMethod).toEqual({
      CASH: 500,
      CARD: 100,
      TRANSFER: 0,
      CREDIT: 0,
      OTHER: 0,
    });
    expect(resultado.totalClosingByMethod).toEqual({
      CASH: 450,
      CARD: 0,
      TRANSFER: 0,
      CREDIT: 0,
      OTHER: 0,
    });
    expect(resultado.totalDiffByMethod).toEqual({
      CASH: -50,
      CARD: 0,
      TRANSFER: 0,
      CREDIT: 0,
      OTHER: 0,
    });
    expect(resultado.expectedByMethod).toEqual(resultado.totalExpectedByMethod);
    expect(resultado.closingByMethod).toEqual(resultado.totalClosingByMethod);
    expect(resultado.diffByMethod).toEqual(resultado.totalDiffByMethod);
    expect(resultado.movimientosPorMotivo).toHaveLength(2);
    // El cierre interno usa el mismo día del corte.
    expect(argsDe(prismaMock.cajaSession.findMany).where).toEqual({
      storeId: STORE,
      openedAt: { gte: mexicoStartOfDay('2026-01-15'), lte: mexicoEndOfDay('2026-01-15') },
    });
    expect(argsDe(prismaMock.cajaMovimiento.findMany).where).toEqual({
      storeId: STORE,
      createdAt: { gte: mexicoStartOfDay('2026-01-15'), lte: mexicoEndOfDay('2026-01-15') },
    });
    expect(argsDe(prismaMock.supplierTransaction.findMany).where).toMatchObject({
      storeId: STORE,
      paidFrom: 'CAJA',
      paymentMethod: 'CASH',
      canceledAt: null,
    });
  });

  it('con control de cajas filtra por operador y ancla el efectivo esperado en cero', async () => {
    mockTienda(true);
    prismaMock.sale.findMany.mockResolvedValue([]);
    mockSinCancelaciones();
    mockInventarioVacio();
    prismaMock.cajaSession.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ openingCash: dec('0.00'), openingElectronic: dec('0.00') }]);
    prismaMock.cajaMovimiento.findMany.mockResolvedValue([
      { tipo: 'EGRESO', metodo: 'CASH', monto: dec('75.00') },
    ]);
    prismaMock.supplierTransaction.findMany.mockResolvedValue([]);

    const resultado = await corteCaja(STORE, '2026-01-15', undefined, undefined, 'user-2');

    expect(resultado.cashExpected).toBe(0);
    expect(resultado.cancelledCountByOperator).toBe(0);
    expect(resultado.salesByPayment).toEqual({});
    expect(argsDe(prismaMock.sale.findMany).where.userId).toBe('user-2');
    expect(argsDe(prismaMock.cajaSession.findMany, 1).where).toEqual({
      storeId: STORE,
      openingDate: { gte: '2026-01-15', lte: '2026-01-15' },
      userId: 'user-2',
    });
    expect(argsDe(prismaMock.cajaMovimiento.findMany).where).toMatchObject({ userId: 'user-2' });
    expect(argsDe(prismaMock.supplierTransaction.findMany).where).toMatchObject({
      userId: 'user-2',
    });
  });

  it('trata como desactivado el control de cajas si la tienda no devuelve configuración', async () => {
    prismaMock.store.findUnique
      .mockResolvedValueOnce(storeFixture({ id: STORE }))
      .mockResolvedValueOnce(null);
    prismaMock.sale.findMany.mockResolvedValue([]);
    mockSinCancelaciones();
    mockInventarioVacio();

    const resultado = await corteCaja(STORE, '2026-01-15');

    expect(resultado.controlCajas).toBe(false);
    expect(prismaMock.cajaSession.findMany).not.toHaveBeenCalled();
  });

  it('con control de cajas y sin fechas consulta la apertura sin rango de días', async () => {
    mockTienda(true);
    prismaMock.sale.findMany.mockResolvedValue([]);
    mockSinCancelaciones();
    mockInventarioVacio();
    prismaMock.cajaSession.findMany.mockResolvedValue([]);
    prismaMock.cajaMovimiento.findMany.mockResolvedValue([]);
    prismaMock.supplierTransaction.findMany.mockResolvedValue([]);

    const resultado = await corteCaja(STORE);

    expect(resultado.controlCajas).toBe(true);
    expect(argsDe(prismaMock.cajaSession.findMany, 1).where).toEqual({
      storeId: STORE,
      openingDate: { gte: '', lte: '' },
    });
    expect(resultado.cashExpected).toBe(0);
  });

  it('usa el día de negocio actual cuando no se pasan fechas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'));
    mockTienda(false);
    prismaMock.sale.findMany.mockResolvedValue([]);
    mockSinCancelaciones();
    mockInventarioVacio();

    const resultado = await corteCaja(STORE);

    expect(resultado.date).toBe('2026-03-15');
    expect(resultado.generatedAt).toBe('2026-03-15T12:00:00.000Z');
    expect(argsDe(prismaMock.sale.findMany).where.createdAt).toEqual({
      gte: mexicoStartOfDay('2026-03-15'),
      lte: mexicoEndOfDay('2026-03-15'),
    });
    // El inventario también se pide para el día actual.
    expect(prismaMock.inventory.findMany).toHaveBeenCalledWith({
      where: { storeId: STORE },
      include: { product: { select: { id: true, name: true, unidadVenta: true, costPrice: true } } },
    });
    expect(resultado.byHour).toHaveLength(24);
  });
});

describe('cierreCaja', () => {
  it('devuelve un arreglo vacío y no consulta movimientos si no hay sesiones', async () => {
    prismaMock.cajaSession.findMany.mockResolvedValue([]);

    const resultado = await cierreCaja(STORE);

    expect(resultado).toEqual({ rows: [] });
    expect(prismaMock.cajaSession.findMany).toHaveBeenCalledWith({
      where: { storeId: STORE },
      include: {
        caja: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: [{ openingDate: 'asc' }, { openedAt: 'asc' }],
    });
    expect(prismaMock.cajaMovimiento.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('filtra por caja, cajero y rango de fechas', async () => {
    prismaMock.cajaSession.findMany.mockResolvedValue([]);

    await cierreCaja(STORE, {
      cajaId: 'caja-9',
      userId: 'user-9',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(argsDe(prismaMock.cajaSession.findMany).where).toEqual({
      storeId: STORE,
      cajaId: 'caja-9',
      userId: 'user-9',
      openedAt: { gte: mexicoStartOfDay('2026-01-01'), lte: mexicoEndOfDay('2026-01-31') },
    });
  });

  it('filtra solo por fecha de inicio', async () => {
    prismaMock.cajaSession.findMany.mockResolvedValue([]);

    await cierreCaja(STORE, { startDate: '2026-01-01' });

    expect(argsDe(prismaMock.cajaSession.findMany).where).toEqual({
      storeId: STORE,
      openedAt: { gte: mexicoStartOfDay('2026-01-01') },
    });
  });

  it('filtra solo por fecha de fin', async () => {
    prismaMock.cajaSession.findMany.mockResolvedValue([]);

    await cierreCaja(STORE, { endDate: '2026-01-31' });

    expect(argsDe(prismaMock.cajaSession.findMany).where).toEqual({
      storeId: STORE,
      openedAt: { lte: mexicoEndOfDay('2026-01-31') },
    });
  });

  it('mapea una sesión cerrada con sus totales, movimientos y detalle por motivo', async () => {
    const sesion = {
      ...cajaSessionFixture({
        id: 'cs-1',
        status: 'CLOSED',
        openedAt: new Date('2026-01-15T15:00:00.000Z'),
        closedAt: new Date('2026-01-15T23:00:00.000Z'),
        openingCash: dec('500.00'),
        openingElectronic: dec('50.00'),
        salesCash: dec('300.00'),
        salesElectronic: dec('120.00'),
        purchasesCash: dec('80.00'),
        purchasesElectronic: dec('20.00'),
        expectedCash: dec('720.00'),
        expectedElectronic: dec('170.00'),
        closingCash: dec('700.00'),
        closingElectronic: dec('170.00'),
        diffCash: dec('-20.00'),
        diffElectronic: dec('0.00'),
        reopenReason: 'Se reabrió para corregir el conteo',
        closingAmounts: { CASH: 700, CARD: 170 },
        expectedAmounts: { CASH: 720, CARD: 170 },
        diffByMethod: { CASH: -20, CARD: 0 },
      }),
      caja: { id: 'caja-1', name: 'Caja 1' },
      user: { id: 'user-1', name: 'Vendedor Uno' },
    };
    prismaMock.cajaSession.findMany.mockResolvedValue([sesion]);
    prismaMock.cajaMovimiento.groupBy.mockResolvedValue([
      { cajaSessionId: 'cs-1', tipo: 'INGRESO', metodo: 'CASH', _sum: { monto: dec('150.00') } },
      { cajaSessionId: 'cs-1', tipo: 'EGRESO', metodo: 'CASH', _sum: { monto: dec('50.00') } },
      { cajaSessionId: 'cs-1', tipo: 'INGRESO', metodo: 'CARD', _sum: { monto: dec('70.00') } },
      { cajaSessionId: 'cs-1', tipo: 'EGRESO', metodo: 'CARD', _sum: { monto: dec('10.00') } },
    ]);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        cajaSessionId: 'cs-1',
        tipo: 'INGRESO',
        metodo: 'CASH',
        motivoId: 'motivo-1',
        motivoTexto: null,
        motivoName: 'Venta',
        total: dec('150.00'),
        cantidad: 2n,
      },
      {
        cajaSessionId: 'cs-1',
        tipo: 'EGRESO',
        metodo: 'CASH',
        motivoId: null,
        motivoTexto: 'Hielo',
        motivoName: null,
        total: dec('50.00'),
        cantidad: 1n,
      },
    ]);

    const { rows } = await cierreCaja(STORE, {
      startDate: '2026-01-15',
      endDate: '2026-01-15',
    });

    expect(rows).toEqual([
      {
        id: 'cs-1',
        cajaId: 'caja-1',
        caja: 'Caja 1',
        userId: 'user-1',
        cajero: 'Vendedor Uno',
        status: 'CLOSED',
        openingDate: '2026-01-15',
        openedAt: '2026-01-15T15:00:00.000Z',
        closedAt: '2026-01-15T23:00:00.000Z',
        openingCash: 500,
        openingElectronic: 50,
        salesCash: 300,
        salesElectronic: 120,
        purchasesCash: 80,
        purchasesElectronic: 20,
        ingresoCash: 150,
        egresoCash: 50,
        ingresoElectronic: 70,
        egresoElectronic: 10,
        expectedCash: 720,
        expectedElectronic: 170,
        closingCash: 700,
        closingElectronic: 170,
        diffCash: -20,
        diffElectronic: 0,
        reopenReason: 'Se reabrió para corregir el conteo',
        closingByMethod: { CASH: 700, CARD: 170 },
        expectedByMethod: { CASH: 720, CARD: 170 },
        diffByMethod: { CASH: -20, CARD: 0 },
        movimientosPorMotivo: [
          { motivoName: 'Venta', tipo: 'INGRESO', metodo: 'CASH', total: 150, cantidad: 2 },
          { motivoName: 'Sin motivo', tipo: 'EGRESO', metodo: 'CASH', total: 50, cantidad: 1 },
        ],
      },
    ]);
    expect(prismaMock.cajaMovimiento.groupBy).toHaveBeenCalledWith({
      by: ['cajaSessionId', 'tipo', 'metodo'],
      where: { cajaSessionId: { in: ['cs-1'] }, storeId: STORE },
      _sum: { monto: true },
    });
  });

  it('deja null los campos de cierre cuando la sesión sigue abierta y sin movimientos', async () => {
    const sesion = {
      ...cajaSessionFixture({ id: 'cs-2', status: 'OPEN', cajaId: 'caja-2' }),
      caja: null,
      user: null,
    };
    prismaMock.cajaSession.findMany.mockResolvedValue([sesion]);
    prismaMock.cajaMovimiento.groupBy.mockResolvedValue([]);

    const { rows } = await cierreCaja(STORE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'cs-2',
      caja: 'Caja',
      cajero: '—',
      status: 'OPEN',
      closedAt: null,
      salesCash: null,
      salesElectronic: null,
      purchasesCash: null,
      purchasesElectronic: null,
      expectedCash: null,
      expectedElectronic: null,
      closingCash: null,
      closingElectronic: null,
      diffCash: null,
      diffElectronic: null,
      reopenReason: null,
      ingresoCash: 0,
      egresoCash: 0,
      ingresoElectronic: 0,
      egresoElectronic: 0,
      closingByMethod: null,
      expectedByMethod: null,
      diffByMethod: null,
      movimientosPorMotivo: [],
    });
    // El detalle por motivo se consulta con el id de la única sesión.
    expect(prismaMock.$queryRaw.mock.calls[0]?.[1]).toEqual(['cs-2']);
  });
});

describe('productsReport', () => {
  it('mapea las filas agregadas y calcula el margen de cada producto', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        productId: 'product-1',
        productName: 'Refresco 600ml',
        category: 'Abarrotes',
        quantitysold: 3n,
        revenue: dec('45.00'),
        profit: dec('15.00'),
      },
      {
        productId: 'product-2',
        productName: 'Producto sin ventas',
        category: null,
        quantitysold: 0n,
        revenue: null,
        profit: null,
      },
    ]);

    const resultado = await productsReport(STORE);

    expect(resultado).toEqual([
      {
        productId: 'product-1',
        productName: 'Refresco 600ml',
        quantitySold: 3,
        revenue: 45,
        profit: 15,
        profitMargin: (15 / 45) * 100,
      },
      {
        productId: 'product-2',
        productName: 'Producto sin ventas',
        quantitySold: 0,
        revenue: 0,
        profit: 0,
        profitMargin: 0,
      },
    ]);
    // No valida la tienda: la consulta ya filtra por storeId.
    expect(prismaMock.store.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw.mock.calls[0]?.[1]).toBe(STORE);
  });

  it('devuelve un arreglo vacío cuando la consulta no trae filas', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    await expect(productsReport(STORE)).resolves.toEqual([]);
  });
});

describe('profitMarginByCategory', () => {
  it('lanza STORE_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => profitMarginByCategory(STORE), {
      status: 404,
      code: 'STORE_NOT_FOUND',
    });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('calcula el costo y el margen por categoría', async () => {
    mockTienda();
    prismaMock.$queryRaw.mockResolvedValue([
      { category: 'Abarrotes', revenue: dec('100.00'), profit: dec('40.00') },
      { category: 'Sin categoría', revenue: null, profit: null },
    ]);

    const resultado = await profitMarginByCategory(STORE);

    expect(resultado).toEqual([
      { category: 'Abarrotes', revenue: 100, cost: 60, profit: 40, profitMargin: 40 },
      { category: 'Sin categoría', revenue: 0, cost: 0, profit: 0, profitMargin: 0 },
    ]);
    expect(prismaMock.$queryRaw.mock.calls[0]?.[1]).toBe(STORE);
  });

  it('devuelve un arreglo vacío cuando no hay categorías con ventas', async () => {
    mockTienda();
    prismaMock.$queryRaw.mockResolvedValue([]);

    await expect(profitMarginByCategory(STORE)).resolves.toEqual([]);
  });
});

describe('suppliersReport', () => {
  it('lanza STORE_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => suppliersReport(STORE), {
      status: 404,
      code: 'STORE_NOT_FOUND',
    });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('mapea el número de compras y el gasto por proveedor', async () => {
    mockTienda();
    prismaMock.$queryRaw.mockResolvedValue([
      {
        supplierId: 'supplier-1',
        supplierName: 'Distribuidora del Norte',
        totalPurchases: 2n,
        totalSpent: dec('500.00'),
      },
      {
        supplierId: 'supplier-2',
        supplierName: 'Proveedor sin gasto',
        totalPurchases: 0n,
        totalSpent: null,
      },
    ]);

    const resultado = await suppliersReport(STORE);

    expect(resultado).toEqual([
      {
        supplierId: 'supplier-1',
        supplierName: 'Distribuidora del Norte',
        totalPurchases: 2,
        totalSpent: 500,
      },
      { supplierId: 'supplier-2', supplierName: 'Proveedor sin gasto', totalPurchases: 0, totalSpent: 0 },
    ]);
    expect(prismaMock.$queryRaw.mock.calls[0]?.[1]).toBe(STORE);
  });

  it('devuelve un arreglo vacío cuando no hay compras', async () => {
    mockTienda();
    prismaMock.$queryRaw.mockResolvedValue([]);

    await expect(suppliersReport(STORE)).resolves.toEqual([]);
  });
});
