import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { productFixture } from '../helpers/fixtures';
import { prismaKnownError } from '../helpers/prismaErrors';
import { expectApiError } from '../helpers/expectApiError';
import {
  createProduct,
  deleteProduct,
  generarSkuAutomatico,
  getProduct,
  listProducts,
  obtenerSiguienteSku,
  updateProduct,
} from '../../src/services/product.service';

function argsFindMany() {
  return prismaMock.product.findMany.mock.calls[0]?.[0] as any;
}

describe('obtenerSiguienteSku', () => {
  it('empieza en PRODUCT-001 sin productos', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);

    await expect(obtenerSiguienteSku()).resolves.toBe('PRODUCT-001');
  });

  it('continúa desde el consecutivo más alto e ignora SKU ajenos', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { sku: 'PRODUCT-002' },
      { sku: 'PRODUCT-005' },
      { sku: '7501234567890' },
      { sku: null },
    ]);

    await expect(obtenerSiguienteSku()).resolves.toBe('PRODUCT-006');
    expect(prismaMock.product.findMany).toHaveBeenCalledWith({
      where: { sku: { startsWith: 'PRODUCT-' } },
      select: { sku: true },
    });
  });
});

describe('generarSkuAutomatico', () => {
  it('avanza mientras el SKU ya esté ocupado', async () => {
    prismaMock.product.findMany.mockResolvedValue([{ sku: 'PRODUCT-001' }]);
    prismaMock.product.findUnique
      .mockResolvedValueOnce(productFixture({ sku: 'PRODUCT-002' }))
      .mockResolvedValueOnce(null);

    await expect(generarSkuAutomatico(prismaMock as any)).resolves.toBe('PRODUCT-003');
  });

  it('devuelve el consecutivo libre a la primera', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    prismaMock.product.findUnique.mockResolvedValue(null);

    await expect(generarSkuAutomatico(prismaMock as any)).resolves.toBe('PRODUCT-001');
  });
});

describe('listProducts', () => {
  it('sin paginación devuelve el listado completo de activos', async () => {
    prismaMock.product.findMany.mockResolvedValue([productFixture()]);

    const resultado = await listProducts({ storeId: 'store-1' });

    expect(resultado.products).toHaveLength(1);
    expect(argsFindMany().where).toEqual({ isActive: true, storeId: 'store-1' });
    expect(argsFindMany().orderBy).toEqual([{ sortOrder: 'asc' }, { name: 'asc' }]);
  });

  it('incluye inactivos cuando se pide', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);

    await listProducts({ storeId: 'store-1', includeInactive: true });

    expect(argsFindMany().where.isActive).toBeUndefined();
  });

  it('busca por nombre, sku o descripción', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);

    await listProducts({ storeId: 'store-1', search: 'refresco' });

    expect(argsFindMany().where.OR).toEqual([
      { name: { contains: 'refresco', mode: 'insensitive' } },
      { sku: { contains: 'refresco', mode: 'insensitive' } },
      { description: { contains: 'refresco', mode: 'insensitive' } },
    ]);
  });

  it('filtra por categoría', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);

    await listProducts({ storeId: 'store-1', category: 'categoria-1' });

    expect(argsFindMany().where.category).toEqual({ id: 'categoria-1' });
  });

  it('ordena por categoría desempatando por nombre', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);

    await listProducts({ storeId: 'store-1', sortBy: 'category', sortOrder: 'desc' });

    expect(argsFindMany().orderBy).toEqual([
      { category: { name: 'desc' } },
      { sortOrder: 'asc' },
      { name: 'asc' },
    ]);
  });

  it('ordena por sku, costo y precio de venta', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);

    await listProducts({ sortBy: 'sku', sortOrder: 'desc' });
    await listProducts({ sortBy: 'costPrice', sortOrder: 'desc' });
    await listProducts({ sortBy: 'sellingPrice' });

    expect(prismaMock.product.findMany.mock.calls[0]?.[0]?.orderBy).toEqual([{ sku: 'desc' }]);
    expect(prismaMock.product.findMany.mock.calls[1]?.[0]?.orderBy).toEqual([
      { costPrice: 'desc' },
    ]);
    expect(prismaMock.product.findMany.mock.calls[2]?.[0]?.orderBy).toEqual([
      { sellingPrice: 'asc' },
    ]);
  });

  it('ordena por nombre cuando sortBy es name', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);

    await listProducts({ sortBy: 'name', sortOrder: 'desc' });

    expect(argsFindMany().orderBy).toEqual([{ sortOrder: 'asc' }, { name: 'desc' }]);
  });

  it('con paginación devuelve metadatos y calcula totalPages', async () => {
    prismaMock.product.findMany.mockResolvedValue([productFixture()]);
    prismaMock.product.count.mockResolvedValue(7);

    const resultado = await listProducts({ storeId: 'store-1', page: 2, limit: 5 });

    expect(resultado).toEqual(
      expect.objectContaining({ total: 7, page: 2, limit: 5, totalPages: 2 })
    );
    expect(argsFindMany().skip).toBe(5);
    expect(argsFindMany().take).toBe(5);
  });

  it('usa límite 50 por defecto al paginar', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    prismaMock.product.count.mockResolvedValue(0);

    const resultado = await listProducts({ page: 1 });

    expect(resultado).toEqual(expect.objectContaining({ limit: 50, totalPages: 1 }));
  });
});

describe('getProduct', () => {
  it('filtra por tienda cuando se indica', async () => {
    prismaMock.product.findFirst.mockResolvedValue(productFixture());

    await getProduct('product-1', 'store-1');

    expect(prismaMock.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'product-1', storeId: 'store-1' },
      include: {
        category: true,
        inventories: { include: { store: true } },
      },
    });
  });

  it('no filtra por tienda cuando se omite', async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);

    await getProduct('product-1');

    expect(prismaMock.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      include: {
        category: true,
        inventories: { include: { store: true } },
      },
    });
  });
});

describe('createProduct', () => {
  const entrada = {
    name: 'Refresco 600ml',
    storeId: 'store-1',
    costPrice: 10,
    sellingPrice: 15,
  };

  it('crea inventario, audita y usa el SKU enviado', async () => {
    prismaMock.product.create.mockResolvedValue(productFixture({ id: 'product-9', sku: 'ABC-1' }));
    prismaMock.inventory.upsert.mockResolvedValue({ id: 'inventory-1' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await createProduct({ ...entrada, sku: '  ABC-1  ' }, 'user-1');

    expect(resultado.id).toBe('product-9');
    const data = prismaMock.product.create.mock.calls[0]?.[0]?.data as any;
    expect(data).toEqual(
      expect.objectContaining({
        name: 'Refresco 600ml',
        sku: 'ABC-1',
        storeId: 'store-1',
        unidadVenta: 'UNIDAD',
        sortOrder: 0,
        isActive: true,
        expirationDate: '2100-02-02T00:00:00Z',
      })
    );
    expect(prismaMock.inventory.upsert).toHaveBeenCalledWith({
      where: { storeId_productId: { storeId: 'store-1', productId: 'product-9' } },
      create: { storeId: 'store-1', productId: 'product-9', quantity: 0 },
      update: {},
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        userId: 'user-1',
        action: 'CREATE',
        entity: 'PRODUCT',
        entityId: 'product-9',
      }),
    });
  });

  it('genera SKU automático cuando no se envía', async () => {
    prismaMock.product.findMany.mockResolvedValue([{ sku: 'PRODUCT-004' }]);
    prismaMock.product.findUnique.mockResolvedValue(null);
    prismaMock.product.create.mockResolvedValue(productFixture({ sku: 'PRODUCT-005' }));

    await createProduct(entrada, 'user-1');

    expect(prismaMock.product.create.mock.calls[0]?.[0]?.data).toEqual(
      expect.objectContaining({ sku: 'PRODUCT-005' })
    );
  });

  it('normaliza presentación vacía a undefined', async () => {
    prismaMock.product.create.mockResolvedValue(productFixture());

    await createProduct({ ...entrada, sku: 'ABC-1', presentacion: '   ' }, 'user-1');

    const data = prismaMock.product.create.mock.calls[0]?.[0]?.data as any;
    expect(data.presentacion).toBeUndefined();
  });

  it('traduce el P2002 a SKU_DUPLICADO', async () => {
    prismaMock.product.create.mockRejectedValue(prismaKnownError('P2002'));

    await expectApiError(() => createProduct({ ...entrada, sku: 'ABC-1' }, 'user-1'), {
      status: 409,
      code: 'SKU_DUPLICADO',
    });
  });

  it('repropaga errores distintos de P2002', async () => {
    const error = new Error('fallo de conexión');
    prismaMock.product.create.mockRejectedValue(error);

    await expect(createProduct({ ...entrada, sku: 'ABC-1' }, 'user-1')).rejects.toBe(error);
  });
});

describe('updateProduct', () => {
  it('lanza PRODUCT_NOT_FOUND si no existe', async () => {
    prismaMock.product.findUnique.mockResolvedValue(null);

    await expectApiError(() => updateProduct('product-x', { name: 'Nuevo' }, 'user-1'), {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('normaliza campos opcionales vacíos a null', async () => {
    prismaMock.product.findUnique.mockResolvedValue(productFixture());
    prismaMock.product.update.mockResolvedValue(productFixture({ sku: null }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await updateProduct(
      'product-1',
      { sku: '  ', description: null, presentacion: '  ', categoryId: null },
      'user-1'
    );

    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { sku: null, description: null, presentacion: null, categoryId: null },
      include: { category: true },
    });
  });

  it('actualiza precios, unidad y vigencia', async () => {
    prismaMock.product.findUnique.mockResolvedValue(productFixture());
    prismaMock.product.update.mockResolvedValue(productFixture());
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-3' });

    await updateProduct(
      'product-1',
      { costPrice: 12, sellingPrice: 18, unidadVenta: 'PESO', isActive: false, sortOrder: 3 },
      'user-1'
    );

    expect(prismaMock.product.update.mock.calls[0]?.[0]?.data).toEqual({
      costPrice: 12,
      sellingPrice: 18,
      unidadVenta: 'PESO',
      isActive: false,
      sortOrder: 3,
    });
  });

  it('audita el cambio con el storeId del producto', async () => {
    prismaMock.product.findUnique.mockResolvedValue(productFixture());
    prismaMock.product.update.mockResolvedValue(productFixture({ id: 'product-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-4' });

    await updateProduct('product-1', { name: 'Nuevo' }, 'user-1');

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'UPDATE',
        entity: 'PRODUCT',
        entityId: 'product-1',
        metadata: { changes: { name: 'Nuevo' } },
      },
    });
  });

  it('traduce el P2002 a SKU_DUPLICADO', async () => {
    prismaMock.product.findUnique.mockResolvedValue(productFixture());
    prismaMock.product.update.mockRejectedValue(prismaKnownError('P2002'));

    await expectApiError(() => updateProduct('product-1', { sku: 'OTRO' }, 'user-1'), {
      status: 409,
      code: 'SKU_DUPLICADO',
    });
  });
});

describe('deleteProduct', () => {
  it('lanza PRODUCT_NOT_FOUND si no existe', async () => {
    prismaMock.product.findUnique.mockResolvedValue(null);

    await expectApiError(() => deleteProduct('product-x', 'user-1'), {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('bloquea el borrado si tiene compras registradas', async () => {
    prismaMock.product.findUnique.mockResolvedValue(productFixture());
    prismaMock.supplierTransactionItem.count.mockResolvedValue(1);

    await expectApiError(() => deleteProduct('product-1', 'user-1'), {
      status: 409,
      code: 'PRODUCTO_CON_COMPRAS',
    });
  });

  it('bloquea el borrado si tiene ventas registradas', async () => {
    prismaMock.product.findUnique.mockResolvedValue(productFixture());
    prismaMock.supplierTransactionItem.count.mockResolvedValue(0);
    prismaMock.saleItem.count.mockResolvedValue(3);

    await expectApiError(() => deleteProduct('product-1', 'user-1'), {
      status: 409,
      code: 'PRODUCTO_CON_VENTAS',
    });
  });

  it('borra el producto y audita cuando no tiene histórico', async () => {
    const existente = productFixture({ id: 'product-1', sku: 'SKU-1' });
    prismaMock.product.findUnique.mockResolvedValue(existente);
    prismaMock.supplierTransactionItem.count.mockResolvedValue(0);
    prismaMock.saleItem.count.mockResolvedValue(0);
    prismaMock.product.delete.mockResolvedValue(existente);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-5' });

    await expect(deleteProduct('product-1', 'user-1')).resolves.toEqual(existente);
    expect(prismaMock.product.delete).toHaveBeenCalledWith({ where: { id: 'product-1' } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'DELETE',
        entity: 'PRODUCT',
        entityId: 'product-1',
        metadata: { name: existente.name, sku: 'SKU-1' },
      },
    });
  });
});
