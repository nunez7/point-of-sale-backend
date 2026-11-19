import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { storeFixture } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import {
  createStore,
  deleteStore,
  getAutoCloseConfig,
  getStoreById,
  listAllStores,
  listMyStores,
  reactivateStore,
  updateStore,
} from '../../src/services/store.service';

describe('getStoreById', () => {
  it('devuelve la tienda', async () => {
    const fila = storeFixture();
    prismaMock.store.findUnique.mockResolvedValue(fila);

    await expect(getStoreById('store-1')).resolves.toEqual(fila);
  });

  it('lanza TIENDA_NOT_FOUND si no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => getStoreById('store-x'), {
      status: 404,
      code: 'TIENDA_NOT_FOUND',
    });
  });
});

describe('createStore', () => {
  const entrada = { name: 'Sucursal Centro', code: 'STORE002' };

  it('lanza TIENDA_CODIGO_DUPLICADO si el código ya existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture());

    await expectApiError(() => createStore(entrada, 'user-1'), {
      status: 409,
      code: 'TIENDA_CODIGO_DUPLICADO',
    });
  });

  it('valida la tienda fuente explícita', async () => {
    prismaMock.store.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storeFixture({ id: 'store-9', isActive: false }));

    await expectApiError(
      () => createStore({ ...entrada, sourceStoreId: 'store-9' }, 'user-1'),
      { status: 400, code: 'SOURCE_STORE_NOT_FOUND' }
    );
  });

  it('lanza SOURCE_STORE_NOT_FOUND si la fuente no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expectApiError(
      () => createStore({ ...entrada, sourceStoreId: 'store-x' }, 'user-1'),
      { status: 400, code: 'SOURCE_STORE_NOT_FOUND' }
    );
  });

  it('crea la tienda con valores por defecto y audita', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);
    prismaMock.userStore.findFirst.mockResolvedValue(null);
    prismaMock.store.create.mockResolvedValue(storeFixture({ id: 'store-2', code: 'STORE002' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await createStore(entrada, 'user-1');

    expect(resultado.id).toBe('store-2');
    expect(prismaMock.store.create).toHaveBeenCalledWith({
      data: {
        name: 'Sucursal Centro',
        code: 'STORE002',
        address: null,
        representante: null,
        phone: null,
        rfc: null,
        regimenFiscal: null,
        codigoPostal: null,
        notifyOutOfStock: true,
        notifyLowStock: true,
        controlCajas: false,
        aperturaCajaConInventario: true,
        isActive: true,
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'CREATE', entity: 'STORE', entityId: 'store-2' }),
    });
  });

  it('copia los catálogos de la tienda primaria del usuario', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);
    prismaMock.userStore.findFirst.mockResolvedValue({
      storeId: 'store-9',
      store: { isActive: true },
    });
    prismaMock.store.create.mockResolvedValue(storeFixture({ id: 'store-2' }));
    prismaMock.category.findMany.mockResolvedValue([{ name: 'Abarrotes' }]);
    prismaMock.cancellationReason.findMany.mockResolvedValue([
      { name: 'Error', isActive: true },
    ]);
    prismaMock.movementReason.findMany.mockResolvedValue([
      { name: 'Merma', tipo: 'SALIDA', departamento: null, isActive: true },
    ]);
    prismaMock.category.createMany.mockResolvedValue({ count: 1 });
    prismaMock.cancellationReason.createMany.mockResolvedValue({ count: 1 });
    prismaMock.movementReason.createMany.mockResolvedValue({ count: 1 });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await createStore(entrada, 'user-1');

    expect(prismaMock.category.createMany).toHaveBeenCalledWith({
      data: [{ name: 'Abarrotes', storeId: 'store-2' }],
    });
    expect(prismaMock.cancellationReason.createMany).toHaveBeenCalledWith({
      data: [{ name: 'Error', isActive: true, storeId: 'store-2' }],
    });
    expect(prismaMock.movementReason.createMany).toHaveBeenCalledWith({
      data: [
        { name: 'Merma', tipo: 'SALIDA', departamento: null, isActive: true, storeId: 'store-2' },
      ],
    });
    expect(prismaMock.auditLog.create).toHaveBeenLastCalledWith({
      data: {
        storeId: 'store-2',
        userId: 'user-1',
        action: 'COPY_CATALOGS',
        entity: 'STORE',
        entityId: 'store-2',
        metadata: {
          sourceStoreId: 'store-9',
          categories: 1,
          cancellationReasons: 1,
          movementReasons: 1,
        },
      },
    });
  });

  it('no copia catálogos cuando la fuente no tiene registros', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);
    prismaMock.userStore.findFirst.mockResolvedValue({
      storeId: 'store-9',
      store: { isActive: true },
    });
    prismaMock.store.create.mockResolvedValue(storeFixture({ id: 'store-2' }));
    prismaMock.category.findMany.mockResolvedValue([]);
    prismaMock.cancellationReason.findMany.mockResolvedValue([]);
    prismaMock.movementReason.findMany.mockResolvedValue([]);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await createStore(entrada, 'user-1');

    expect(prismaMock.category.createMany).not.toHaveBeenCalled();
    expect(prismaMock.cancellationReason.createMany).not.toHaveBeenCalled();
    expect(prismaMock.movementReason.createMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        action: 'COPY_CATALOGS',
        metadata: {
          sourceStoreId: 'store-9',
          categories: 0,
          cancellationReasons: 0,
          movementReasons: 0,
        },
      }),
    });
  });

  it('ignora la tienda primaria si está inactiva', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);
    prismaMock.userStore.findFirst.mockResolvedValue({
      storeId: 'store-9',
      store: { isActive: false },
    });
    prismaMock.store.create.mockResolvedValue(storeFixture({ id: 'store-2' }));

    await createStore(entrada, 'user-1');

    expect(prismaMock.category.findMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('usa la tienda fuente explícita cuando está activa', async () => {
    prismaMock.store.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storeFixture({ id: 'store-9', isActive: true }));
    prismaMock.store.create.mockResolvedValue(storeFixture({ id: 'store-2' }));
    prismaMock.category.findMany.mockResolvedValue([]);
    prismaMock.cancellationReason.findMany.mockResolvedValue([]);
    prismaMock.movementReason.findMany.mockResolvedValue([]);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await createStore({ ...entrada, sourceStoreId: 'store-9' }, 'user-1');

    expect(prismaMock.category.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-9' },
      select: { name: true },
    });
    expect(prismaMock.auditLog.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        action: 'COPY_CATALOGS',
        metadata: expect.objectContaining({ sourceStoreId: 'store-9' }),
      }),
    });
  });
});

describe('listMyStores', () => {
  it('descarta tiendas inactivas y aplana los datos', async () => {
    prismaMock.userStore.findMany.mockResolvedValue([
      {
        storeId: 'store-1',
        role: 'ADMIN',
        isPrimary: true,
        store: { id: 'store-1', name: 'Matriz', code: 'STORE001', isActive: true },
      },
      {
        storeId: 'store-2',
        role: 'VENDEDOR',
        isPrimary: false,
        store: { id: 'store-2', name: 'Cerrada', code: 'STORE002', isActive: false },
      },
    ]);

    await expect(listMyStores('user-1')).resolves.toEqual([
      { storeId: 'store-1', name: 'Matriz', code: 'STORE001', role: 'ADMIN', isPrimary: true },
    ]);
  });
});

describe('listAllStores', () => {
  it('lista todas las tiendas ordenadas por nombre', async () => {
    prismaMock.store.findMany.mockResolvedValue([storeFixture()]);

    const resultado = await listAllStores();

    expect(resultado).toHaveLength(1);
    expect(prismaMock.store.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        phone: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });
  });
});

describe('deleteStore', () => {
  it('lanza TIENDA_NOT_FOUND si no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => deleteStore('store-x', 'user-1'), {
      status: 404,
      code: 'TIENDA_NOT_FOUND',
    });
  });

  it('desactiva la tienda y audita el borrado lógico', async () => {
    prismaMock.store.findUnique.mockResolvedValue(
      storeFixture({ id: 'store-1', name: 'Matriz', code: 'STORE001' })
    );
    prismaMock.store.update.mockResolvedValue(storeFixture({ isActive: false }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await expect(deleteStore('store-1', 'user-1')).resolves.toEqual({
      id: 'store-1',
      message: 'Tienda desactivada',
    });
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { isActive: false },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'DELETE',
        entity: 'STORE',
        entityId: 'store-1',
        metadata: { name: 'Matriz', code: 'STORE001' },
      },
    });
  });
});

describe('reactivateStore', () => {
  it('lanza TIENDA_NOT_FOUND si no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => reactivateStore('store-x', 'user-1'), {
      status: 404,
      code: 'TIENDA_NOT_FOUND',
    });
  });

  it('reactiva la tienda y audita la acción', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-1' }));
    prismaMock.store.update.mockResolvedValue(storeFixture({ isActive: true }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await reactivateStore('store-1', 'user-1');

    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { isActive: true },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'UPDATE',
        metadata: expect.objectContaining({ action: 'REACTIVATE' }),
      }),
    });
  });
});

describe('updateStore', () => {
  it('lanza TIENDA_NOT_FOUND si no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => updateStore('store-x', { name: 'Nueva' }, 'user-1'), {
      status: 404,
      code: 'TIENDA_NOT_FOUND',
    });
  });

  it('actualiza solo los campos enviados y usa la acción por defecto', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-1' }));
    prismaMock.store.update.mockResolvedValue(storeFixture({ id: 'store-1', name: 'Nueva' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await updateStore('store-1', { name: 'Nueva', controlCajas: true }, 'user-1');

    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { name: 'Nueva', controlCajas: true },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'UPDATE',
        entity: 'STORE',
        entityId: 'store-1',
        metadata: { changes: { name: 'Nueva', controlCajas: true } },
      },
    });
  });

  it('respeta una acción personalizada en la auditoría', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture());
    prismaMock.store.update.mockResolvedValue(storeFixture());
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await updateStore('store-1', { autoCloseEnabled: false }, 'user-1', 'AUTO_CLOSE_CONFIG');

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'AUTO_CLOSE_CONFIG' }),
    });
  });

  it('permite limpiar campos opcionales con null', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture());
    prismaMock.store.update.mockResolvedValue(storeFixture());
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await updateStore('store-1', { address: null, phone: null }, 'user-1');

    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { address: null, phone: null },
    });
  });

  it('traduce el P2002 a TIENDA_CODIGO_DUPLICADO', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture());
    prismaMock.store.update.mockRejectedValue({ code: 'P2002' });

    await expectApiError(() => updateStore('store-1', { code: 'STORE001' }, 'user-1'), {
      status: 409,
      code: 'TIENDA_CODIGO_DUPLICADO',
    });
  });

  it('repropaga errores que no son P2002', async () => {
    const error = new Error('fallo de conexión');
    prismaMock.store.findUnique.mockResolvedValue(storeFixture());
    prismaMock.store.update.mockRejectedValue(error);

    await expect(updateStore('store-1', { name: 'Nueva' }, 'user-1')).rejects.toBe(error);
  });

  it('actualiza todos los campos cuando se envían completos', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture());
    prismaMock.store.update.mockResolvedValue(storeFixture());
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-9' });

    await updateStore(
      'store-1',
      {
        name: 'Matriz',
        code: 'STORE001',
        address: 'Calle 1',
        representante: 'Ana',
        phone: '6671234567',
        rfc: 'XAXX010101000',
        regimenFiscal: '601',
        codigoPostal: '81200',
        notifyOutOfStock: false,
        notifyLowStock: false,
        controlCajas: true,
        aperturaCajaConInventario: false,
        autoCloseEnabled: true,
        autoCloseTime: '22:00',
        autoCloseDays: ['1', '2'],
        diasLimiteDevolucion: 15,
      },
      'user-1'
    );

    expect(prismaMock.store.update.mock.calls[0]?.[0]?.data).toEqual({
      name: 'Matriz',
      code: 'STORE001',
      address: 'Calle 1',
      representante: 'Ana',
      phone: '6671234567',
      rfc: 'XAXX010101000',
      regimenFiscal: '601',
      codigoPostal: '81200',
      notifyOutOfStock: false,
      notifyLowStock: false,
      controlCajas: true,
      aperturaCajaConInventario: false,
      autoCloseEnabled: true,
      autoCloseTime: '22:00',
      autoCloseDays: ['1', '2'],
      diasLimiteDevolucion: 15,
    });
  });
});

describe('getAutoCloseConfig', () => {
  it('devuelve los valores por defecto si la tienda no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expect(getAutoCloseConfig('store-x')).resolves.toEqual({
      autoCloseEnabled: false,
      autoCloseTime: null,
      autoCloseDays: ['1', '2', '3', '4', '5', '6'],
    });
  });

  it('devuelve la configuración de la tienda', async () => {
    prismaMock.store.findUnique.mockResolvedValue({
      autoCloseEnabled: true,
      autoCloseTime: '22:00',
      autoCloseDays: ['1', '2'],
    });

    await expect(getAutoCloseConfig('store-1')).resolves.toEqual({
      autoCloseEnabled: true,
      autoCloseTime: '22:00',
      autoCloseDays: ['1', '2'],
    });
  });
});
