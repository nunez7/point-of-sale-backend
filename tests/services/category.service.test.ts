import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { categoryFixture } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../../src/services/category.service';

describe('listCategories', () => {
  it('sin storeId lista todas las categorías ordenadas por nombre', async () => {
    const filas = [categoryFixture({ id: 'categoria-1', name: 'Abarrotes' })];
    prismaMock.category.findMany.mockResolvedValue(filas);

    const resultado = await listCategories();

    expect(resultado).toEqual(filas);
    expect(prismaMock.category.findMany).toHaveBeenCalledWith({
      where: undefined,
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
  });

  it('con storeId filtra por tienda', async () => {
    prismaMock.category.findMany.mockResolvedValue([]);

    await listCategories('store-1');

    expect(prismaMock.category.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
  });
});

describe('createCategory', () => {
  it('crea la categoría y registra el AuditLog dentro de la transacción', async () => {
    const creada = categoryFixture({ id: 'categoria-9', name: 'Lácteos' });
    prismaMock.category.create.mockResolvedValue(creada);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await createCategory({ name: 'Lácteos', storeId: 'store-1' }, 'user-1');

    expect(resultado).toEqual(creada);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.category.create).toHaveBeenCalledWith({
      data: { name: 'Lácteos', storeId: 'store-1' },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'CREATE',
        entity: 'CATEGORY',
        entityId: 'categoria-9',
        metadata: { name: 'Lácteos' },
      },
    });
  });

  it('traduce el error P2002 a CATEGORIA_DUPLICADA (409)', async () => {
    prismaMock.category.create.mockRejectedValue({ code: 'P2002' });

    await expectApiError(() => createCategory({ name: 'Lácteos', storeId: 'store-1' }, 'user-1'), {
      status: 409,
      code: 'CATEGORIA_DUPLICADA',
    });
  });

  it('repropaga cualquier otro error sin transformarlo', async () => {
    const error = new Error('se cayó la base');
    prismaMock.category.create.mockRejectedValue(error);

    await expect(createCategory({ name: 'Lácteos', storeId: 'store-1' }, 'user-1')).rejects.toBe(
      error
    );
  });
});

describe('updateCategory', () => {
  it('lanza CATEGORIA_NOT_FOUND si no existe', async () => {
    prismaMock.category.findUnique.mockResolvedValue(null);

    await expectApiError(() => updateCategory('categoria-x', { name: 'Nueva' }, 'user-1'), {
      status: 404,
      code: 'CATEGORIA_NOT_FOUND',
    });
    expect(prismaMock.category.update).not.toHaveBeenCalled();
  });

  it('actualiza solo los campos enviados y audita el cambio', async () => {
    const existente = categoryFixture({ id: 'categoria-1' });
    const actualizada = categoryFixture({ id: 'categoria-1', name: 'Nueva' });
    prismaMock.category.findUnique.mockResolvedValue(existente);
    prismaMock.category.update.mockResolvedValue(actualizada);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    const resultado = await updateCategory('categoria-1', { name: 'Nueva' }, 'user-1');

    expect(resultado).toEqual(actualizada);
    expect(prismaMock.category.update).toHaveBeenCalledWith({
      where: { id: 'categoria-1' },
      data: { name: 'Nueva' },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'UPDATE',
        entity: 'CATEGORY',
        entityId: 'categoria-1',
        metadata: { changes: { name: 'Nueva' } },
      },
    });
  });

  it('traduce el error P2002 a CATEGORIA_DUPLICADA (409)', async () => {
    prismaMock.category.findUnique.mockResolvedValue(categoryFixture());
    prismaMock.category.update.mockRejectedValue({ code: 'P2002' });

    await expectApiError(
      () => updateCategory('categoria-1', { name: 'Repetida' }, 'user-1'),
      { status: 409, code: 'CATEGORIA_DUPLICADA' }
    );
  });
});

describe('deleteCategory', () => {
  it('lanza CATEGORIA_NOT_FOUND si no existe', async () => {
    prismaMock.category.findUnique.mockResolvedValue(null);

    await expectApiError(() => deleteCategory('categoria-x', 'user-1'), {
      status: 404,
      code: 'CATEGORIA_NOT_FOUND',
    });
  });

  it('lanza CATEGORIA_CON_PRODUCTOS si la categoría tiene productos', async () => {
    prismaMock.category.findUnique.mockResolvedValue(categoryFixture());
    prismaMock.product.count.mockResolvedValue(3);

    await expectApiError(() => deleteCategory('categoria-1', 'user-1'), {
      status: 409,
      code: 'CATEGORIA_CON_PRODUCTOS',
      message: /3 producto\(s\)/,
    });
    expect(prismaMock.category.delete).not.toHaveBeenCalled();
  });

  it('elimina y audita cuando no hay productos asociados', async () => {
    const existente = categoryFixture({ id: 'categoria-1' });
    prismaMock.category.findUnique.mockResolvedValue(existente);
    prismaMock.product.count.mockResolvedValue(0);
    prismaMock.category.delete.mockResolvedValue(existente);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-3' });

    const resultado = await deleteCategory('categoria-1', 'user-1');

    expect(resultado).toEqual(existente);
    expect(prismaMock.category.delete).toHaveBeenCalledWith({ where: { id: 'categoria-1' } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'DELETE',
        entity: 'CATEGORY',
        entityId: 'categoria-1',
        metadata: { name: 'Abarrotes' },
      },
    });
  });
});
