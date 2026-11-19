import { afterEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { dec, inventoryLotFixture, userFixture } from '../helpers/fixtures';
import { emitToStore } from '../../src/socket/socket';
import { env } from '../../src/config/env';
import {
  getScheduledStores,
  initScheduler,
  scheduleExpiredProducts,
  scheduleStoreAutoClose,
  stopStoreAutoClose,
} from '../../src/services/scheduler.service';

// ---------------------------------------------------------------------------
// Doble de node-cron: no programa temporizadores reales, solo captura las
// tareas para poder invocar su callback a mano.
// ---------------------------------------------------------------------------

interface TareaFalsa {
  expresion: string;
  fn: () => Promise<void>;
  opciones: { timezone?: string } | undefined;
  stop: ReturnType<typeof vi.fn>;
}

const h = vi.hoisted(() => ({
  tareas: [] as TareaFalsa[],
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function programarTarea(
  expresion: string,
  fn: () => Promise<void>,
  opciones?: { timezone?: string }
): TareaFalsa {
  const tarea: TareaFalsa = { expresion, fn, opciones, stop: vi.fn() };
  h.tareas.push(tarea);
  return tarea;
}

vi.mock('node-cron', () => ({
  default: { schedule: programarTarea },
  schedule: programarTarea,
}));

vi.mock('../../src/config/logger', () => ({ logger: h.logger }));

const TZ = 'America/Mazatlan';

function tarea(indice = 0): TareaFalsa {
  return h.tareas[indice];
}

afterEach(() => {
  vi.useRealTimers();
  for (const storeId of getScheduledStores()) stopStoreAutoClose(storeId);
  h.tareas.length = 0;
});

// ---------------------------------------------------------------------------
// initScheduler
// ---------------------------------------------------------------------------

describe('initScheduler', () => {
  it('programa una tarea por tienda con cierre automático y el job de caducidades', async () => {
    prismaMock.store.findMany.mockResolvedValue([
      { id: 'store-1', autoCloseTime: '08:30', autoCloseDays: ['2', '1'] },
      { id: 'store-2', autoCloseTime: '21:00', autoCloseDays: ['0'] },
    ]);

    await initScheduler();

    expect(prismaMock.store.findMany).toHaveBeenCalledWith({
      where: { autoCloseEnabled: true, autoCloseTime: { not: null } },
      select: { id: true, autoCloseTime: true, autoCloseDays: true },
    });
    expect(h.tareas.map((t) => t.expresion)).toEqual([
      '30 8 * * 1,2',
      '0 21 * * 0',
      '0 8 * * *',
    ]);
    expect(getScheduledStores()).toEqual(['store-1', 'store-2']);
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Scheduler initialized for 2 store(s)')
    );
  });

  it('usa America/Mazatlan cuando la configuración no define zona horaria', async () => {
    vi.doMock('../../src/config/env', () => ({ env: { ...env, TIMEZONE: undefined } }));
    // El especificador va en una variable para que Vitest resuelva el .ts en
    // tiempo de ejecución (un import literal exige extensión bajo node16).
    const rutaServicio = '../../src/services/scheduler.service';
    try {
      vi.resetModules();
      const modulo = (await import(rutaServicio)) as {
        scheduleStoreAutoClose: (storeId: string, time: string, days: string[]) => void;
      };

      modulo.scheduleStoreAutoClose('store-tz', '07:15', ['1']);

      expect(h.tareas).toHaveLength(1);
      expect(h.tareas[0].opciones).toEqual({ timezone: TZ });
    } finally {
      vi.doUnmock('../../src/config/env');
      vi.resetModules();
    }
  });

  it('solo programa el job de caducidades cuando ninguna tienda lo tiene activo', async () => {
    prismaMock.store.findMany.mockResolvedValue([]);

    await initScheduler();

    expect(h.tareas.map((t) => t.expresion)).toEqual(['0 8 * * *']);
    expect(getScheduledStores()).toEqual([]);
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Scheduler initialized for 0 store(s)')
    );
  });
});

// ---------------------------------------------------------------------------
// scheduleStoreAutoClose
// ---------------------------------------------------------------------------

describe('scheduleStoreAutoClose', () => {
  it('registra la tarea con la expresión cron y la zona horaria del negocio', () => {
    scheduleStoreAutoClose('store-1', '08:30', ['1', '2']);

    expect(h.tareas).toHaveLength(1);
    expect(tarea()).toMatchObject({
      expresion: '30 8 * * 1,2',
      opciones: { timezone: TZ },
    });
    expect(getScheduledStores()).toEqual(['store-1']);
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[AutoClose] Scheduled for store store-1: 30 8 * * 1,2')
    );
  });

  it('detiene la tarea anterior cuando se reprograma la misma tienda', () => {
    scheduleStoreAutoClose('store-1', '08:30', ['1']);
    const primera = tarea();

    scheduleStoreAutoClose('store-1', '09:45', ['3']);

    expect(primera.stop).toHaveBeenCalledTimes(1);
    expect(h.tareas).toHaveLength(2);
    expect(getScheduledStores()).toEqual(['store-1']);
    expect(tarea(1).expresion).toBe('45 9 * * 3');
  });

  it('el callback ejecuta el cierre automático y registra el resultado', async () => {
    scheduleStoreAutoClose('store-1', '08:30', ['1']);
    prismaMock.user.findFirst.mockResolvedValue(userFixture({ id: 'user-admin' }));
    prismaMock.cajaSession.findMany.mockResolvedValue([]);

    await tarea().fn();

    expect(h.logger.info).toHaveBeenCalledWith('[AutoClose] Running for store store-1');
    expect(h.logger.info).toHaveBeenCalledWith(
      '[AutoClose] Store store-1: closed 0 session(s)'
    );
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('el callback registra el error del cierre sin propagarlo', async () => {
    scheduleStoreAutoClose('store-1', '08:30', ['1']);
    prismaMock.user.findFirst.mockResolvedValue(null);

    await expect(tarea().fn()).resolves.toBeUndefined();

    expect(h.logger.error).toHaveBeenCalledWith(
      '[AutoClose] Store store-1 failed:',
      expect.any(Error)
    );
  });
});

// ---------------------------------------------------------------------------
// stopStoreAutoClose
// ---------------------------------------------------------------------------

describe('stopStoreAutoClose', () => {
  it('detiene la tarea y la quita del registro', () => {
    scheduleStoreAutoClose('store-1', '08:30', ['1']);
    const programada = tarea();

    stopStoreAutoClose('store-1');

    expect(programada.stop).toHaveBeenCalledTimes(1);
    expect(getScheduledStores()).toEqual([]);
    expect(h.logger.info).toHaveBeenCalledWith('[AutoClose] Stopped for store store-1');
  });

  it('no falla si la tienda no tiene tarea programada', () => {
    stopStoreAutoClose('store-x');

    expect(getScheduledStores()).toEqual([]);
    expect(h.logger.info).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getScheduledStores
// ---------------------------------------------------------------------------

describe('getScheduledStores', () => {
  it('devuelve las tiendas registradas en orden de programación', () => {
    expect(getScheduledStores()).toEqual([]);

    scheduleStoreAutoClose('store-1', '08:00', ['1']);
    scheduleStoreAutoClose('store-2', '09:00', ['2']);

    expect(getScheduledStores()).toEqual(['store-1', 'store-2']);
  });
});

// ---------------------------------------------------------------------------
// scheduleExpiredProducts
// ---------------------------------------------------------------------------

describe('scheduleExpiredProducts', () => {
  it('programa el job diario a las 08:00 con la zona horaria del negocio', () => {
    scheduleExpiredProducts();

    expect(h.tareas).toHaveLength(1);
    expect(tarea()).toMatchObject({ expresion: '0 8 * * *', opciones: { timezone: TZ } });
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[ExpiredProducts] Job programado diariamente a las 08:00')
    );
  });

  it('emite una alerta por tienda separando caducados de por vencer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-10T12:00:00.000Z'));
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      {
        ...inventoryLotFixture({
          id: 'lot-1',
          storeId: 'store-1',
          productId: 'product-1',
          availableQty: dec('3.000'),
          expirationDate: new Date('2026-02-01T00:00:00.000Z'),
        }),
        product: { name: 'Refresco 600ml', sku: 'SKU-001' },
      },
      {
        ...inventoryLotFixture({
          id: 'lot-2',
          storeId: 'store-1',
          productId: 'product-2',
          availableQty: dec('1.500'),
          expirationDate: new Date('2026-02-15T00:00:00.000Z'),
        }),
        product: { name: 'Yogurt', sku: null },
      },
      {
        ...inventoryLotFixture({
          id: 'lot-3',
          storeId: 'store-2',
          productId: 'product-3',
          expirationDate: null,
        }),
        product: { name: 'Sin caducidad', sku: null },
      },
    ]);

    scheduleExpiredProducts();
    await tarea().fn();

    expect(prismaMock.inventoryLot.findMany).toHaveBeenCalledWith({
      where: { availableQty: { gt: 0 }, expirationDate: { not: null, lte: expect.any(Date) } },
      include: { product: { select: { name: true, sku: true } } },
      orderBy: [{ expirationDate: 'asc' }],
    });
    // store-2 solo tiene el lote sin caducidad: no se emite nada para esa tienda.
    expect(emitToStore).toHaveBeenCalledTimes(1);
    expect(emitToStore).toHaveBeenCalledWith('store-1', 'inventory:expiration-alert', {
      storeId: 'store-1',
      dias: 7,
      lots: [
        {
          lotId: 'lot-1',
          productId: 'product-1',
          productName: 'Refresco 600ml',
          sku: 'SKU-001',
          availableQty: 3,
          expirationDate: '2026-02-01',
          diasParaVencer: -9,
        },
        {
          lotId: 'lot-2',
          productId: 'product-2',
          productName: 'Yogurt',
          sku: null,
          availableQty: 1.5,
          expirationDate: '2026-02-15',
          diasParaVencer: 5,
        },
      ],
      caducados: [expect.objectContaining({ lotId: 'lot-1' })],
      porVencer: [expect.objectContaining({ lotId: 'lot-2' })],
    });
    expect(h.logger.info).toHaveBeenCalledWith(
      '[ExpiredProducts] 3 lote(s) próximos a expirar en 1 tienda(s)'
    );
  });

  it('registra el error si falla la consulta de lotes', async () => {
    prismaMock.inventoryLot.findMany.mockRejectedValue(new Error('BD caída'));

    scheduleExpiredProducts();
    await expect(tarea().fn()).resolves.toBeUndefined();

    expect(h.logger.error).toHaveBeenCalledWith(
      '[ExpiredProducts] Error al verificar lotes próximos a expirar:',
      expect.any(Error)
    );
    expect(emitToStore).not.toHaveBeenCalled();
  });
});
