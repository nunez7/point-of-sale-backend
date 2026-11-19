import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { cajaFixture, cajaSessionFixture, dec, userFixture } from '../helpers/fixtures';
import { Prisma } from '../../generated/prisma/client.js';
import {
  autoCloseStoreSessions,
  buildCronExpression,
} from '../../src/services/autoClose.service';

// ---------------------------------------------------------------------------
// Fixtures locales
// ---------------------------------------------------------------------------

const AHORA = new Date('2026-01-15T18:00:00.000Z');
// 2026-01-15T18:00Z son las 11:00 en America/Mazatlan: mismo día de negocio.
const DIA_LOCAL = '2026-01-15';

function sesionDelDia(overrides: Record<string, unknown> = {}) {
  return {
    ...cajaSessionFixture({ id: 'cajasession-1' }),
    caja: cajaFixture({ id: 'caja-1' }),
    ...overrides,
  };
}

/** Corte sin ventas, compras ni movimientos: el esperado es la apertura. */
function corteVacio() {
  prismaMock.sale.groupBy.mockResolvedValue([]);
  prismaMock.supplierTransaction.groupBy.mockResolvedValue([]);
  prismaMock.cajaMovimiento.findMany.mockResolvedValue([]);
}

function datosUpdate(indice = 0): any {
  return prismaMock.cajaSession.update.mock.calls[indice]?.[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// autoCloseStoreSessions
// ---------------------------------------------------------------------------

describe('autoCloseStoreSessions', () => {
  it('cierra la sesión abierta del día, copia el corte y audita', async () => {
    prismaMock.user.findFirst.mockResolvedValue(userFixture({ id: 'user-admin', role: 'ADMIN' }));
    prismaMock.cajaSession.findMany.mockResolvedValue([sesionDelDia()]);
    corteVacio();
    prismaMock.cajaSession.update.mockResolvedValue(
      cajaSessionFixture({ id: 'cajasession-1', status: 'CLOSED' })
    );

    await expect(autoCloseStoreSessions('store-1')).resolves.toEqual({ closed: 1 });

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        isActive: true,
        role: 'ADMIN',
        userStores: { some: { storeId: 'store-1' } },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(prismaMock.cajaSession.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', status: 'OPEN', openingDate: DIA_LOCAL },
      include: { caja: true },
    });

    const datos = datosUpdate();
    expect(datos).toEqual({
      where: { id: 'cajasession-1' },
      data: {
        status: 'CLOSED',
        closedAt: AHORA,
        closingDate: '2026-01-15',
        closedBy: 'user-admin',
        closingCash: expect.any(Prisma.Decimal),
        closingElectronic: expect.any(Prisma.Decimal),
        closingNote: 'Cierre automático',
        salesCash: expect.any(Prisma.Decimal),
        salesElectronic: expect.any(Prisma.Decimal),
        purchasesCash: expect.any(Prisma.Decimal),
        purchasesElectronic: expect.any(Prisma.Decimal),
        expectedCash: expect.any(Prisma.Decimal),
        expectedElectronic: expect.any(Prisma.Decimal),
        diffCash: expect.any(Prisma.Decimal),
        diffElectronic: expect.any(Prisma.Decimal),
      },
    });
    expect(Number(datos.data.closingCash)).toBe(500);
    expect(Number(datos.data.expectedElectronic)).toBe(0);
    expect(Number(datos.data.diffCash)).toBe(0);

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        userId: 'user-admin',
        action: 'AUTO_CLOSE_CAJA',
        entity: 'CajaSession',
        entityId: 'cajasession-1',
        metadata: {
          cajaId: 'caja-1',
          expectedCash: '500',
          expectedElectronic: '0',
        },
      }),
    });
  });

  it('usa el primer usuario activo de la tienda cuando no hay ADMIN', async () => {
    prismaMock.user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(userFixture({ id: 'user-2', role: 'GERENTE' }));
    prismaMock.cajaSession.findMany.mockResolvedValue([sesionDelDia()]);
    corteVacio();
    prismaMock.cajaSession.update.mockResolvedValue(cajaSessionFixture());

    await autoCloseStoreSessions('store-1');

    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMock.user.findFirst).toHaveBeenLastCalledWith({
      where: { isActive: true, userStores: { some: { storeId: 'store-1' } } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(datosUpdate().data.closedBy).toBe('user-2');
  });

  it('lanza un error si la tienda no tiene usuarios activos', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    await expect(autoCloseStoreSessions('store-1')).rejects.toThrow(
      'No active user found for store'
    );
    expect(prismaMock.cajaSession.findMany).not.toHaveBeenCalled();
    expect(prismaMock.cajaSession.update).not.toHaveBeenCalled();
  });

  it('devuelve cero cierres cuando no hay sesiones abiertas del día', async () => {
    prismaMock.user.findFirst.mockResolvedValue(userFixture({ id: 'user-admin' }));
    prismaMock.cajaSession.findMany.mockResolvedValue([]);

    await expect(autoCloseStoreSessions('store-1')).resolves.toEqual({ closed: 0 });
    expect(prismaMock.cajaSession.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('cierra todas las sesiones abiertas de la tienda', async () => {
    prismaMock.user.findFirst.mockResolvedValue(userFixture({ id: 'user-admin' }));
    prismaMock.cajaSession.findMany.mockResolvedValue([
      sesionDelDia({ id: 'cajasession-1' }),
      sesionDelDia({ id: 'cajasession-2', cajaId: 'caja-2' }),
    ]);
    corteVacio();
    prismaMock.cajaSession.update.mockResolvedValue(cajaSessionFixture());

    await expect(autoCloseStoreSessions('store-1')).resolves.toEqual({ closed: 2 });

    expect(prismaMock.cajaSession.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.cajaSession.update.mock.calls[1]?.[0]).toMatchObject({
      where: { id: 'cajasession-2' },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(2);
  });

  it('refleja las ventas del turno en el corte esperado', async () => {
    prismaMock.user.findFirst.mockResolvedValue(userFixture({ id: 'user-admin' }));
    prismaMock.cajaSession.findMany.mockResolvedValue([
      sesionDelDia({ openingCash: dec('100.00'), openingElectronic: dec('0.00') }),
    ]);
    prismaMock.sale.groupBy.mockResolvedValue([
      { paymentMethod: 'CASH', _sum: { total: dec('250.00') } },
      { paymentMethod: 'CARD', _sum: { total: dec('80.00') } },
    ]);
    prismaMock.supplierTransaction.groupBy.mockResolvedValue([]);
    prismaMock.cajaMovimiento.findMany.mockResolvedValue([
      { tipo: 'INGRESO', metodo: 'CASH', monto: dec('20.00') },
    ]);
    prismaMock.cajaSession.update.mockResolvedValue(cajaSessionFixture());

    await autoCloseStoreSessions('store-1');

    const datos = datosUpdate().data;
    expect(Number(datos.salesCash)).toBe(250);
    expect(Number(datos.salesElectronic)).toBe(80);
    expect(Number(datos.expectedCash)).toBe(370);
    expect(Number(datos.expectedElectronic)).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// buildCronExpression
// ---------------------------------------------------------------------------

describe('buildCronExpression', () => {
  it('convierte hora y días en una expresión cron ordenada', () => {
    expect(buildCronExpression('08:30', ['5', '1', '3'])).toBe('30 8 * * 1,3,5');
  });

  it('admite un solo día y minutos con cero a la izquierda', () => {
    expect(buildCronExpression('00:05', ['0'])).toBe('5 0 * * 0');
  });

  it('mantiene el orden numérico con días de dos cifras', () => {
    expect(buildCronExpression('21:45', ['10', '2', '1'])).toBe('45 21 * * 1,2,10');
  });
});
