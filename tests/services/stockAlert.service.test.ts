import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { dec } from '../helpers/fixtures';
import { emitToStore } from '../../src/socket/socket';
import {
  checkStockAlert,
  getExpirationAlerts,
  getStockAlerts,
} from '../../src/services/stockAlert.service';

// ---------------------------------------------------------------------------
// Fixtures locales
// ---------------------------------------------------------------------------

const AHORA = new Date('2026-02-25T18:00:00.000Z');

function filaInventario(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inventory-1',
    storeId: 'store-1',
    productId: 'product-1',
    quantity: dec('10.000'),
    lowStockThreshold: 5,
    product: { name: 'Refresco 600ml' },
    store: { notifyOutOfStock: true, notifyLowStock: true },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// checkStockAlert
// ---------------------------------------------------------------------------

describe('checkStockAlert', () => {
  it('no emite nada si el producto no tiene inventario en la tienda', async () => {
    prismaMock.inventory.findUnique.mockResolvedValue(null);

    await checkStockAlert('store-1', 'product-x', { before: 5, delta: 5, decrease: true });

    expect(prismaMock.inventory.findUnique).toHaveBeenCalledWith({
      where: { storeId_productId: { storeId: 'store-1', productId: 'product-x' } },
      include: {
        product: { select: { name: true } },
        store: { select: { notifyOutOfStock: true, notifyLowStock: true } },
      },
    });
    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('emite OUT_OF_STOCK cuando el stock baja de positivo a cero', async () => {
    prismaMock.inventory.findUnique.mockResolvedValue(
      filaInventario({ quantity: dec('0.000') })
    );

    await checkStockAlert('store-1', 'product-1', { before: 1 });

    expect(vi.mocked(emitToStore)).toHaveBeenCalledWith('store-1', 'inventory:alert', {
      storeId: 'store-1',
      productId: 'product-1',
      productName: 'Refresco 600ml',
      quantity: 0,
      type: 'OUT_OF_STOCK',
      threshold: 5,
      at: AHORA.toISOString(),
    });
  });

  it('no emite OUT_OF_STOCK si la tienda desactivó esa notificación', async () => {
    prismaMock.inventory.findUnique.mockResolvedValue(
      filaInventario({
        quantity: dec('0.000'),
        store: { notifyOutOfStock: false, notifyLowStock: true },
      })
    );

    await checkStockAlert('store-1', 'product-1', { before: 2 });

    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('no emite OUT_OF_STOCK si antes ya estaba en cero', async () => {
    prismaMock.inventory.findUnique.mockResolvedValue(
      filaInventario({ quantity: dec('0.000') })
    );

    await checkStockAlert('store-1', 'product-1', { before: 0 });

    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('emite LOW_STOCK al cruzar hacia abajo el umbral', async () => {
    prismaMock.inventory.findUnique.mockResolvedValue(
      filaInventario({ quantity: dec('3.000'), lowStockThreshold: 5 })
    );

    await checkStockAlert('store-1', 'product-1', { before: 6 });

    expect(vi.mocked(emitToStore)).toHaveBeenCalledWith('store-1', 'inventory:alert', {
      storeId: 'store-1',
      productId: 'product-1',
      productName: 'Refresco 600ml',
      quantity: 3,
      type: 'LOW_STOCK',
      threshold: 5,
      at: AHORA.toISOString(),
    });
  });

  it('no emite LOW_STOCK si el stock ya estaba por debajo del umbral', async () => {
    prismaMock.inventory.findUnique.mockResolvedValue(
      filaInventario({ quantity: dec('3.000'), lowStockThreshold: 5 })
    );

    await checkStockAlert('store-1', 'product-1', { before: 4 });

    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('no emite LOW_STOCK si la tienda desactivó esa notificación', async () => {
    prismaMock.inventory.findUnique.mockResolvedValue(
      filaInventario({
        quantity: dec('3.000'),
        store: { notifyOutOfStock: true, notifyLowStock: false },
      })
    );

    await checkStockAlert('store-1', 'product-1', { before: 9 });

    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('deriva el saldo previo sumando el delta cuando el movimiento restó stock', async () => {
    prismaMock.inventory.findUnique.mockResolvedValue(
      filaInventario({ quantity: dec('0.000') })
    );

    await checkStockAlert('store-1', 'product-1', { delta: 2, decrease: true });

    expect(vi.mocked(emitToStore)).toHaveBeenCalledWith(
      'store-1',
      'inventory:alert',
      expect.objectContaining({ type: 'OUT_OF_STOCK', quantity: 0 })
    );
  });

  it('deriva el saldo previo restando el delta cuando el movimiento sumó stock', async () => {
    prismaMock.inventory.findUnique.mockResolvedValue(
      filaInventario({ quantity: dec('8.000'), lowStockThreshold: 5 })
    );

    // before = 8 - 3 = 5, que no supera el umbral: no hay cruce descendente.
    await checkStockAlert('store-1', 'product-1', { delta: 3, decrease: false });

    expect(emitToStore).not.toHaveBeenCalled();
  });

  it('usa la cantidad actual como saldo previo cuando no recibe delta', async () => {
    prismaMock.inventory.findUnique.mockResolvedValue(
      filaInventario({ quantity: dec('0.000') })
    );

    await checkStockAlert('store-1', 'product-1');

    expect(emitToStore).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getStockAlerts
// ---------------------------------------------------------------------------

describe('getStockAlerts', () => {
  it('devuelve una lista vacía si la tienda no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expect(getStockAlerts('store-x')).resolves.toEqual([]);
    expect(prismaMock.inventory.findMany).not.toHaveBeenCalled();
  });

  it('clasifica los productos agotados y con stock bajo', async () => {
    prismaMock.store.findUnique.mockResolvedValue({
      notifyOutOfStock: true,
      notifyLowStock: true,
    });
    prismaMock.inventory.findMany.mockResolvedValue([
      filaInventario({
        productId: 'product-1',
        quantity: dec('0.000'),
        product: { name: 'Refresco 600ml', sku: 'SKU-001' },
      }),
      filaInventario({
        productId: 'product-2',
        quantity: dec('2.000'),
        lowStockThreshold: 5,
        product: { name: 'Sabritas', sku: null },
      }),
      filaInventario({
        productId: 'product-3',
        quantity: dec('50.000'),
        lowStockThreshold: 5,
        product: { name: 'Agua 1L', sku: 'SKU-003' },
      }),
    ]);

    const alertas = await getStockAlerts('store-1');

    expect(alertas).toEqual([
      {
        productId: 'product-1',
        productName: 'Refresco 600ml',
        sku: 'SKU-001',
        quantity: 0,
        threshold: 5,
        type: 'OUT_OF_STOCK',
      },
      {
        productId: 'product-2',
        productName: 'Sabritas',
        sku: null,
        quantity: 2,
        threshold: 5,
        type: 'LOW_STOCK',
      },
    ]);
    expect(prismaMock.store.findUnique).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      select: { notifyOutOfStock: true, notifyLowStock: true },
    });
    expect(prismaMock.inventory.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      include: { product: { select: { name: true, sku: true } } },
    });
  });

  it('respeta las notificaciones desactivadas de la tienda', async () => {
    prismaMock.store.findUnique.mockResolvedValue({
      notifyOutOfStock: false,
      notifyLowStock: false,
    });
    prismaMock.inventory.findMany.mockResolvedValue([
      filaInventario({ productId: 'product-1', quantity: dec('0.000') }),
      filaInventario({ productId: 'product-2', quantity: dec('1.000') }),
    ]);

    await expect(getStockAlerts('store-1')).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getExpirationAlerts
// ---------------------------------------------------------------------------

describe('getExpirationAlerts', () => {
  it('consulta los productos que caducan en los próximos siete días', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);

    await expect(getExpirationAlerts('store-1')).resolves.toEqual([]);
    expect(prismaMock.product.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 'store-1',
        expirationDate: {
          gte: AHORA,
          lte: new Date(AHORA.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      select: { id: true, name: true, expirationDate: true },
    });
  });

  it('formatea la fecha y usa un respaldo cuando falta la caducidad', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: 'product-1',
        name: 'Yogurt',
        expirationDate: new Date('2026-03-01T00:00:00.000Z'),
      },
      { id: 'product-2', name: 'Sin caducidad', expirationDate: null },
    ]);

    const alertas = await getExpirationAlerts('store-1');

    expect(alertas).toEqual([
      { productId: 'product-1', productName: 'Yogurt', expirationDate: '2026-03-01' },
      {
        productId: 'product-2',
        productName: 'Sin caducidad',
        expirationDate: '2100-02-02',
      },
    ]);
  });
});
