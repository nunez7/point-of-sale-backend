import { describe, expect, it, vi } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { dec, inventoryFixture, productFixture } from '../helpers/fixtures';
import { emitToStore } from '../../src/socket/socket';
import {
  emitInventoryEvent,
  getInventoryByStore,
  getLowStock,
} from '../../src/services/inventory.service';

function filaInventario(overrides: Record<string, unknown> = {}) {
  return {
    ...inventoryFixture(),
    product: { ...productFixture(), category: null },
    ...overrides,
  };
}

function argsFindMany() {
  return prismaMock.inventory.findMany.mock.calls[0]?.[0] as any;
}

describe('getInventoryByStore', () => {
  it('sin paginación devuelve el listado completo con conteo de lotes', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([filaInventario()]);
    prismaMock.inventoryLot.groupBy.mockResolvedValue([
      {
        productId: 'product-1',
        _min: { expirationDate: new Date('2026-03-01T00:00:00.000Z') },
        _count: { _all: 2 },
      },
    ]);

    const resultado = await getInventoryByStore('store-1');

    expect(resultado).toEqual({
      inventory: [
        expect.objectContaining({
          productId: 'product-1',
          quantity: 10,
          nextExpirationDate: '2026-03-01',
          lotsCount: 2,
        }),
      ],
    });
    expect(prismaMock.inventory.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      include: { product: { include: { category: true } } },
      orderBy: [{ product: { name: 'asc' } }],
    });
  });

  it('no consulta lotes cuando no hay inventario', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([]);

    const resultado = await getInventoryByStore('store-1');

    expect(resultado.inventory).toEqual([]);
    expect(prismaMock.inventoryLot.groupBy).not.toHaveBeenCalled();
  });

  it('deja los lotes en cero cuando el producto no tiene caducidades', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([filaInventario()]);
    prismaMock.inventoryLot.groupBy.mockResolvedValue([]);

    const resultado = await getInventoryByStore('store-1');

    expect(resultado.inventory[0]).toEqual(
      expect.objectContaining({ nextExpirationDate: null, lotsCount: 0 })
    );
  });

  it('filtra por nombre de producto cuando hay búsqueda', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([]);

    await getInventoryByStore('store-1', { search: 'refresco' });

    expect(argsFindMany().where).toEqual({
      storeId: 'store-1',
      product: { name: { contains: 'refresco', mode: 'insensitive' } },
    });
  });

  it('ordena por categoría desempatando por nombre', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([]);

    await getInventoryByStore('store-1', { sortBy: 'category', sortOrder: 'desc' });

    expect(argsFindMany().orderBy).toEqual([
      { product: { category: { name: 'desc' } } },
      { product: { name: 'asc' } },
    ]);
  });

  it('ordena por nombre', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([]);

    await getInventoryByStore('store-1', { sortBy: 'name' });

    expect(argsFindMany().orderBy).toEqual([{ product: { name: 'asc' } }]);
  });

  it('ordena por umbral de stock bajo', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([]);

    await getInventoryByStore('store-1', { sortBy: 'lowStockThreshold', sortOrder: 'desc' });

    expect(argsFindMany().orderBy).toEqual([{ lowStockThreshold: 'desc' }]);
  });

  it('ordena por cantidad', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([]);

    await getInventoryByStore('store-1', { sortBy: 'quantity' });

    expect(argsFindMany().orderBy).toEqual([{ quantity: 'asc' }]);
  });

  it('con paginación devuelve total, página y totalPages', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([filaInventario()]);
    prismaMock.inventory.count.mockResolvedValue(120);
    prismaMock.inventoryLot.groupBy.mockResolvedValue([]);

    const resultado = await getInventoryByStore('store-1', { page: 3, limit: 50 });

    expect(resultado).toEqual(
      expect.objectContaining({ total: 120, page: 3, limit: 50, totalPages: 3 })
    );
    expect(argsFindMany().skip).toBe(100);
    expect(argsFindMany().take).toBe(50);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('usa límite 50 y mínimo una página cuando no se especifican', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([]);
    prismaMock.inventory.count.mockResolvedValue(0);

    const resultado = await getInventoryByStore('store-1', { page: 1 });

    expect(resultado).toEqual(
      expect.objectContaining({ limit: 50, totalPages: 1 })
    );
  });
});

describe('getLowStock', () => {
  it('devuelve lista vacía sin consultar productos cuando no hay candidatos', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    await expect(getLowStock('store-1')).resolves.toEqual([]);
    expect(prismaMock.inventory.findMany).not.toHaveBeenCalled();
  });

  it('marca lowStock y normaliza la cantidad', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'inventory-1' }]);
    prismaMock.inventory.findMany.mockResolvedValue([
      { ...filaInventario({ quantity: dec('2.500') }) },
    ]);

    const resultado = await getLowStock('store-1');

    expect(resultado).toEqual([
      expect.objectContaining({ quantity: 2.5, lowStock: true }),
    ]);
    expect(prismaMock.inventory.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['inventory-1'] } },
      include: { product: { include: { category: true } } },
    });
  });
});

describe('emitInventoryEvent', () => {
  it('emite inventory:updated a la tienda', () => {
    emitInventoryEvent('store-1', { productId: 'product-1' });

    expect(vi.mocked(emitToStore)).toHaveBeenCalledWith('store-1', 'inventory:updated', {
      productId: 'product-1',
    });
  });
});
