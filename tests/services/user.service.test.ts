import { describe, expect, it, vi } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { storeFixture, userFixture } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import {
  createUser,
  deleteUser,
  listUsers,
  setUserStores,
  updateUser,
} from '../../src/services/user.service';

// bcrypt real tarda ~100 ms por hash y hace la suite lenta y no determinista.
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (valor: string) => `hash:${valor}`),
    compare: vi.fn(async () => true),
  },
}));

describe('listUsers', () => {
  it('aplana la relación de tiendas con nombre y código', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        email: 'v@servicaja.com',
        name: 'Vendedor',
        role: 'VENDEDOR',
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date('2026-01-15T18:00:00.000Z'),
        userStores: [
          {
            storeId: 'store-1',
            role: 'VENDEDOR',
            isPrimary: true,
            store: { id: 'store-1', name: 'Abarrotes', code: 'STORE001' },
          },
        ],
      },
    ]);

    const resultado = await listUsers('store-1');

    expect(resultado[0].userStores).toEqual([
      { storeId: 'store-1', role: 'VENDEDOR', isPrimary: true, name: 'Abarrotes', code: 'STORE001' },
    ]);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    );
    const args = prismaMock.user.findMany.mock.calls[0]?.[0] as any;
    expect(args.where).toEqual({ userStores: { some: { storeId: 'store-1' } } });
  });
});

describe('createUser', () => {
  const entrada = {
    email: 'nuevo@servicaja.com',
    password: 'secreto123',
    name: 'Nuevo Usuario',
    role: 'VENDEDOR' as const,
    storeId: 'store-1',
  };

  it('lanza EMAIL_TAKEN si el correo ya existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture());

    await expectApiError(() => createUser(entrada, 'admin-1'), {
      status: 409,
      code: 'EMAIL_TAKEN',
    });
  });

  it('lanza STORE_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => createUser(entrada, 'admin-1'), {
      status: 404,
      code: 'STORE_NOT_FOUND',
    });
  });

  it('crea el usuario con contraseña hasheada, tienda primaria y auditoría', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue(storeFixture());
    prismaMock.user.create.mockResolvedValue(
      userFixture({ id: 'user-9', email: entrada.email, name: entrada.name })
    );
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await createUser(entrada, 'admin-1');

    expect(resultado.id).toBe('user-9');
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: {
        email: 'nuevo@servicaja.com',
        password: 'hash:secreto123',
        name: 'Nuevo Usuario',
        role: 'VENDEDOR',
        userStores: { create: { storeId: 'store-1', role: 'VENDEDOR', isPrimary: true } },
      },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'admin-1',
        action: 'CREATE',
        entity: 'USER',
        entityId: 'user-9',
        metadata: { email: 'nuevo@servicaja.com', role: 'VENDEDOR', storeId: 'store-1' },
      },
    });
  });
});

describe('updateUser', () => {
  it('lanza USER_NOT_FOUND si el usuario no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expectApiError(() => updateUser('user-x', {}, 'admin-1'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('protege los usuarios SOPORTE frente a otros actores', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      userFixture({ id: 'soporte-1', role: 'SOPORTE' })
    );

    await expectApiError(() => updateUser('soporte-1', { name: 'X' }, 'admin-1'), {
      status: 403,
      code: 'SUPPORT_USER_PROTECTED',
    });
  });

  it('permite que el propio usuario SOPORTE se edite', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...userFixture({ id: 'soporte-1', role: 'SOPORTE' }),
      userStores: [],
    });
    prismaMock.user.update.mockResolvedValue(userFixture({ id: 'soporte-1', name: 'Nuevo' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await updateUser('soporte-1', { name: 'Nuevo' }, 'soporte-1');

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'soporte-1' },
      data: { name: 'Nuevo' },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
  });

  it('hashea la contraseña cuando se envía', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...userFixture({ id: 'user-1' }),
      userStores: [{ storeId: 'store-1' }],
    });
    prismaMock.user.update.mockResolvedValue(userFixture({ id: 'user-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-3' });

    await updateUser('user-1', { password: 'nueva123', isActive: false }, 'admin-1');

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { isActive: false, password: 'hash:nueva123' },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'admin-1',
        action: 'UPDATE',
        entity: 'USER',
        entityId: 'user-1',
        metadata: { changes: { password: 'nueva123', isActive: false } },
      },
    });
  });

  it('no audita si el usuario no tiene tienda primaria', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...userFixture(), userStores: [] });
    prismaMock.user.update.mockResolvedValue(userFixture());

    const resultado = await updateUser('user-1', { name: 'Nuevo' }, 'admin-1');

    expect(resultado).toBeDefined();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('deleteUser', () => {
  it('lanza USER_NOT_FOUND si no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expectApiError(() => deleteUser('user-x', 'admin-1'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('impide que un ADMIN se elimine a sí mismo', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture({ id: 'admin-1', role: 'ADMIN' }));

    await expectApiError(() => deleteUser('admin-1', 'admin-1'), {
      status: 400,
      code: 'CANNOT_DELETE_SELF',
    });
  });

  it('protege los usuarios SOPORTE', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      userFixture({ id: 'soporte-1', role: 'SOPORTE' })
    );

    await expectApiError(() => deleteUser('soporte-1', 'admin-1'), {
      status: 403,
      code: 'SUPPORT_USER_PROTECTED',
    });
  });

  it('desactiva el usuario y audita el borrado lógico', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...userFixture({ id: 'user-1', email: 'v@servicaja.com' }),
      userStores: [{ storeId: 'store-1' }],
    });
    prismaMock.user.update.mockResolvedValue(userFixture({ id: 'user-1', isActive: false }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-4' });

    await expect(deleteUser('user-1', 'admin-1')).resolves.toEqual({
      id: 'user-1',
      message: 'Usuario desactivado',
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { isActive: false },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'admin-1',
        action: 'DELETE',
        entity: 'USER',
        entityId: 'user-1',
        metadata: { email: 'v@servicaja.com' },
      },
    });
  });
});

describe('setUserStores', () => {
  it('lanza USER_NOT_FOUND si el usuario no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expectApiError(() => setUserStores('user-x', { stores: [] }, 'admin-1'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('protege los usuarios SOPORTE frente a otros actores', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      userFixture({ id: 'soporte-1', role: 'SOPORTE' })
    );

    await expectApiError(
      () => setUserStores('soporte-1', { stores: [{ storeId: 'store-1', role: 'SOPORTE' }] }, 'admin-1'),
      { status: 403, code: 'SUPPORT_USER_PROTECTED' }
    );
  });

  it('exige al menos una tienda', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture());

    await expectApiError(() => setUserStores('user-1', { stores: [] }, 'admin-1'), {
      status: 400,
      code: 'USER_MUST_HAVE_STORES',
    });
  });

  it('lanza STORE_NOT_FOUND si alguna tienda no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture());
    prismaMock.store.findMany.mockResolvedValue([{ id: 'store-1' }]);

    await expectApiError(
      () =>
        setUserStores(
          'user-1',
          {
            stores: [
              { storeId: 'store-1', role: 'VENDEDOR' },
              { storeId: 'store-2', role: 'VENDEDOR' },
            ],
          },
          'admin-1'
        ),
      { status: 404, code: 'STORE_NOT_FOUND' }
    );
  });

  it('reemplaza las tiendas y audita usando la primaria', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture());
    prismaMock.store.findMany.mockResolvedValue([{ id: 'store-1' }, { id: 'store-2' }]);
    prismaMock.userStore.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.userStore.createMany.mockResolvedValue({ count: 2 });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-5' });

    const tiendas = [
      { storeId: 'store-1', role: 'VENDEDOR' as const },
      { storeId: 'store-2', role: 'GERENTE' as const, isPrimary: true },
    ];

    const resultado = await setUserStores('user-1', { stores: tiendas }, 'admin-1');

    expect(resultado).toEqual({ id: 'user-1', stores: tiendas });
    expect(prismaMock.userStore.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(prismaMock.userStore.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'user-1', storeId: 'store-1', role: 'VENDEDOR', isPrimary: false },
        { userId: 'user-1', storeId: 'store-2', role: 'GERENTE', isPrimary: true },
      ],
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-2',
        userId: 'admin-1',
        action: 'UPDATE',
        entity: 'USER',
        entityId: 'user-1',
        metadata: { action: 'SET_USER_STORES', stores: tiendas },
      },
    });
  });

  it('usa la primera tienda como fallback de auditoría sin primaria', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture());
    prismaMock.store.findMany.mockResolvedValue([{ id: 'store-7' }]);
    prismaMock.userStore.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.userStore.createMany.mockResolvedValue({ count: 1 });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-6' });

    await setUserStores('user-1', { stores: [{ storeId: 'store-7', role: 'VENDEDOR' }] }, 'admin-1');

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ storeId: 'store-7' }),
    });
  });
});
