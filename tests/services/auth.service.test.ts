import { describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prismaMock } from '../helpers/prismaMock';
import { storeFixture, userFixture } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import { Role } from '../../generated/prisma/client.js';
import { sha256 } from '../../src/utils/tokenHash';
import {
  authorizeCajaClose,
  authorizeCajaOpen,
  buildCajaContext,
  changeMyPassword,
  getMe,
  login,
  logout,
  selectStore,
  updateMe,
  verifyCurrentPassword,
} from '../../src/services/auth.service';

// bcrypt real tarda ~100 ms por hash: el doble mantiene la suite rápida y
// determinista. Lo que se prueba es la lógica del servicio, no el algoritmo.
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (valor: string) => `hash:${valor}`),
    compare: vi.fn(async () => true),
  },
}));

// La firma del JWT se reduce a un valor predecible para poder afirmar sobre
// el payload sin depender de la librería.
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn((payload: { userId: string }) => `jwt:${payload.userId}`),
  },
}));

const FECHA = new Date('2026-01-15T18:00:00.000Z');

type CompareFn = (valor: string, hash: string) => Promise<boolean>;

/**
 * Fuerza el resultado de la siguiente comparación de contraseña.
 * `bcrypt.compare` está sobrecargado (versión con callback → `void`), así que se
 * estrecha a la firma promisificada antes de tipar el mock.
 */
function proximoCompare(resultado: boolean): void {
  vi.mocked(bcrypt.compare as CompareFn).mockResolvedValueOnce(resultado);
}

interface FilaTienda {
  storeId: string;
  role: Role;
  isPrimary: boolean;
  store: { id: string; name: string; code: string };
}

function filaTienda(
  storeId: string,
  name: string,
  role: Role,
  isPrimary = false
): FilaTienda {
  return { storeId, role, isPrimary, store: { id: storeId, name, code: `CODE-${storeId}` } };
}

function sesionAbierta() {
  return { id: 'sesion-1', cajaId: 'caja-9', status: 'OPEN', openedAt: FECHA };
}

describe('login', () => {
  it('lanza INVALID_CREDENTIALS si el correo no está registrado', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expectApiError(() => login('nadie@servicaja.com', 'secreto'), {
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Credenciales inválidas',
    });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'nadie@servicaja.com' },
    });
  });

  it('lanza USER_INACTIVE si el usuario está desactivado', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture({ isActive: false }));

    await expectApiError(() => login('vendedor@servicaja.com', 'secreto'), {
      status: 403,
      code: 'USER_INACTIVE',
    });
    expect(prismaMock.userStore.findMany).not.toHaveBeenCalled();
  });

  it('lanza INVALID_CREDENTIALS si la contraseña no coincide', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture({ id: 'user-1' }));
    proximoCompare(false);

    await expectApiError(() => login('vendedor@servicaja.com', 'mala'), {
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('lanza USER_HAS_NO_STORES si el usuario no tiene tiendas asignadas', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture({ id: 'user-1' }));
    prismaMock.userStore.findMany.mockResolvedValue([]);

    await expectApiError(() => login('vendedor@servicaja.com', 'secreto'), {
      status: 403,
      code: 'USER_HAS_NO_STORES',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('devuelve token, usuario público y contexto de caja de la tienda primaria', async () => {
    const usuario = userFixture({
      id: 'user-1',
      email: 'admin@servicaja.com',
      name: 'Admin Servicaja',
      role: Role.ADMIN,
    });
    prismaMock.user.findUnique.mockResolvedValue(usuario);
    // Cada llamada recibe un arreglo nuevo: el servicio lo ordena in situ.
    prismaMock.userStore.findMany.mockImplementation(async () => [
      filaTienda('store-2', 'Sucursal Zeta', Role.VENDEDOR),
      filaTienda('store-1', 'Matriz Alfa', Role.ADMIN, true),
    ]);
    prismaMock.user.update.mockResolvedValue(usuario);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    prismaMock.store.findUnique.mockResolvedValue(
      storeFixture({ id: 'store-1', controlCajas: true, aperturaCajaConInventario: false })
    );
    prismaMock.caja.findFirst.mockResolvedValue({ id: 'caja-9', name: 'Caja 1' });
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());

    const resultado = await login('admin@servicaja.com', 'admin123');

    expect(resultado.token).toBe('jwt:user-1');
    expect(resultado.user).toEqual({
      id: 'user-1',
      email: 'admin@servicaja.com',
      name: 'Admin Servicaja',
      role: 'ADMIN',
      storeId: 'store-1',
      stores: [
        {
          storeId: 'store-1',
          name: 'Matriz Alfa',
          code: 'CODE-store-1',
          role: 'ADMIN',
          isPrimary: true,
        },
        {
          storeId: 'store-2',
          name: 'Sucursal Zeta',
          code: 'CODE-store-2',
          role: 'VENDEDOR',
          isPrimary: false,
        },
      ],
    });
    expect(resultado.store).toEqual({
      controlCajas: true,
      aperturaCajaConInventario: false,
    });
    expect(resultado.caja).toEqual({ id: 'caja-9', name: 'Caja 1' });
    expect(resultado.session).toEqual(sesionAbierta());

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'LOGIN',
        entity: 'USER',
        entityId: 'user-1',
        metadata: { email: 'admin@servicaja.com' },
      },
    });
    expect(jwt.sign).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        storeId: 'store-1',
        role: 'ADMIN',
        email: 'admin@servicaja.com',
        name: 'Admin Servicaja',
        isActive: true,
        stores: [
          { storeId: 'store-2', role: 'VENDEDOR' },
          { storeId: 'store-1', role: 'ADMIN' },
        ],
      },
      expect.any(String),
      { expiresIn: '8h' }
    );
  });

  it('usa la primera tienda cuando ninguna está marcada como primaria', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      userFixture({ id: 'user-1', email: 'vendedor@servicaja.com', role: Role.VENDEDOR })
    );
    prismaMock.userStore.findMany.mockImplementation(async () => [
      filaTienda('store-9', 'Zeta', Role.VENDEDOR),
      filaTienda('store-3', 'Alfa', Role.VENDEDOR),
    ]);
    prismaMock.user.update.mockResolvedValue(userFixture({ id: 'user-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-9' }));
    prismaMock.caja.findFirst.mockResolvedValue(null);

    const resultado = await login('vendedor@servicaja.com', 'secreto');

    // pickInitialStoreId cae a stores[0] y el detalle se ordena por nombre.
    expect(resultado.user.storeId).toBe('store-9');
    expect(resultado.user.stores.map((s) => s.name)).toEqual(['Alfa', 'Zeta']);
    // Sin caja asignada y sin rol privilegiado no se busca sesión abierta.
    expect(resultado.caja).toBeNull();
    expect(resultado.session).toBeNull();
    expect(prismaMock.cajaSession.findFirst).not.toHaveBeenCalled();
  });
});

describe('selectStore', () => {
  it('lanza USER_NOT_FOUND si el usuario no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expectApiError(() => selectStore('user-x', 'store-1'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('lanza USER_INACTIVE si el usuario está desactivado', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      userFixture({ id: 'user-1', isActive: false })
    );

    await expectApiError(() => selectStore('user-1', 'store-1'), {
      status: 403,
      code: 'USER_INACTIVE',
    });
    expect(prismaMock.store.findUnique).not.toHaveBeenCalled();
  });

  it('lanza STORE_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture({ id: 'user-1' }));
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => selectStore('user-1', 'store-x'), {
      status: 404,
      code: 'STORE_NOT_FOUND',
    });
  });

  it('lanza STORE_INACTIVE si la tienda está desactivada', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture({ id: 'user-1' }));
    prismaMock.store.findUnique.mockResolvedValue({ id: 'store-1', isActive: false });

    await expectApiError(() => selectStore('user-1', 'store-1'), {
      status: 403,
      code: 'STORE_INACTIVE',
    });
  });

  it('lanza STORE_ACCESS_DENIED si un VENDEDOR no tiene membresía', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      userFixture({ id: 'user-1', role: Role.VENDEDOR })
    );
    prismaMock.store.findUnique.mockResolvedValue({ id: 'store-9', isActive: true });
    prismaMock.userStore.findUnique.mockResolvedValue(null);

    await expectApiError(() => selectStore('user-1', 'store-9'), {
      status: 403,
      code: 'STORE_ACCESS_DENIED',
    });
    expect(prismaMock.userStore.findMany).not.toHaveBeenCalled();
  });

  it('permite a un ADMIN entrar a cualquier tienda activa sin membresía', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@servicaja.com',
      name: 'Admin',
      role: Role.ADMIN,
      isActive: true,
    });
    prismaMock.store.findUnique.mockResolvedValue({ id: 'store-9', isActive: true });
    prismaMock.userStore.findUnique.mockResolvedValue(null);
    prismaMock.userStore.findMany.mockResolvedValue([
      filaTienda('store-1', 'Matriz', Role.ADMIN, true),
    ]);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    prismaMock.caja.findFirst.mockResolvedValue(null);
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    const resultado = await selectStore('user-1', 'store-9');

    expect(resultado.token).toBe('jwt:user-1');
    expect(resultado.user.storeId).toBe('store-9');
    expect(resultado.user.stores).toEqual([
      {
        storeId: 'store-1',
        name: 'Matriz',
        code: 'CODE-store-1',
        role: 'ADMIN',
        isPrimary: true,
      },
    ]);
    // Sin membresía se conserva el rol global y se marca privileged.
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ADMIN', storeId: 'store-9' }),
      expect.any(String),
      { expiresIn: '8h' }
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-9',
        userId: 'user-1',
        action: 'SELECT_STORE',
        entity: 'USER',
        entityId: 'user-1',
        metadata: { storeId: 'store-9', privileged: true },
      },
    });
  });

  it('usa el rol de la membresía y no marca privileged cuando es GERENTE miembro', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'gerente@servicaja.com',
      name: 'Gerente',
      role: Role.GERENTE,
      isActive: true,
    });
    prismaMock.store.findUnique.mockResolvedValue({ id: 'store-2', isActive: true });
    prismaMock.userStore.findUnique.mockResolvedValue({
      userId: 'user-1',
      storeId: 'store-2',
      role: Role.GERENTE,
      isPrimary: false,
    });
    prismaMock.userStore.findMany.mockResolvedValue([
      filaTienda('store-2', 'Sucursal', Role.GERENTE),
    ]);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });
    prismaMock.store.findUnique
      .mockResolvedValueOnce({ id: 'store-2', isActive: true })
      .mockResolvedValue(
        storeFixture({ id: 'store-2', controlCajas: true, aperturaCajaConInventario: true })
      );
    prismaMock.caja.findFirst.mockResolvedValue(null);
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    const resultado = await selectStore('user-1', 'store-2');

    expect(resultado.store).toEqual({
      controlCajas: true,
      aperturaCajaConInventario: true,
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: { storeId: 'store-2', privileged: false } }),
    });
  });

  it('permite a un GERENTE entrar sin membresía', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'gerente@servicaja.com',
      name: 'Gerente',
      role: Role.GERENTE,
      isActive: true,
    });
    prismaMock.store.findUnique.mockResolvedValue({ id: 'store-5', isActive: true });
    prismaMock.userStore.findUnique.mockResolvedValue(null);
    prismaMock.userStore.findMany.mockResolvedValue([]);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-3' });
    prismaMock.caja.findFirst.mockResolvedValue({ id: 'caja-9', name: 'Caja 1' });
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());

    const resultado = await selectStore('user-1', 'store-5');

    expect(resultado.user.stores).toEqual([]);
    expect(resultado.session).toEqual(sesionAbierta());
  });
});

describe('logout', () => {
  it('revoca el token y audita el cierre de sesión en la primera tienda', async () => {
    prismaMock.revokedToken.create.mockResolvedValue({ id: 'revocado-1' });
    prismaMock.user.findUnique.mockResolvedValue(userFixture({ id: 'user-1' }));
    prismaMock.userStore.findMany.mockResolvedValue([
      filaTienda('store-1', 'Matriz', Role.VENDEDOR, true),
    ]);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await logout('user-1', 'token-secreto');

    expect(resultado).toBeUndefined();
    expect(prismaMock.revokedToken.create).toHaveBeenCalledWith({
      data: {
        tokenHash: sha256('token-secreto'),
        userId: 'user-1',
        expiresAt: expect.any(Date),
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'LOGOUT',
        entity: 'USER',
        entityId: 'user-1',
        metadata: undefined,
      },
    });
  });

  it('no revoca ni audita cuando no hay token ni usuario', async () => {
    await logout('', '');

    expect(prismaMock.revokedToken.create).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('revoca con userId nulo cuando solo llega el token', async () => {
    prismaMock.revokedToken.create.mockResolvedValue({ id: 'revocado-2' });

    await logout('', 'solo-token');

    expect(prismaMock.revokedToken.create).toHaveBeenCalledWith({
      data: {
        tokenHash: sha256('solo-token'),
        userId: null,
        expiresAt: expect.any(Date),
      },
    });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('no audita si el usuario ya no existe', async () => {
    prismaMock.revokedToken.create.mockResolvedValue({ id: 'revocado-3' });
    prismaMock.user.findUnique.mockResolvedValue(null);

    await logout('user-x', 'token');

    expect(prismaMock.userStore.findMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('no audita si el usuario no tiene tiendas', async () => {
    prismaMock.revokedToken.create.mockResolvedValue({ id: 'revocado-4' });
    prismaMock.user.findUnique.mockResolvedValue(userFixture({ id: 'user-1' }));
    prismaMock.userStore.findMany.mockResolvedValue([]);

    await logout('user-1', 'token');

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('getMe', () => {
  it('lanza USER_NOT_FOUND si el usuario no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expectApiError(() => getMe('user-x'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('lanza USER_HAS_NO_STORES si no tiene tiendas asignadas', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture({ id: 'user-1' }));
    prismaMock.userStore.findMany.mockResolvedValue([]);

    await expectApiError(() => getMe('user-1'), {
      status: 403,
      code: 'USER_HAS_NO_STORES',
    });
  });

  it('devuelve el perfil con la tienda primaria como contexto', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'vendedor@servicaja.com',
      name: 'Vendedor',
      role: Role.VENDEDOR,
      isActive: true,
      createdAt: FECHA,
    });
    prismaMock.userStore.findMany.mockImplementation(async () => [
      filaTienda('store-1', 'Matriz Alfa', Role.VENDEDOR, true),
      filaTienda('store-2', 'Sucursal Zeta', Role.GERENTE),
    ]);
    prismaMock.store.findUnique.mockResolvedValue(
      storeFixture({ id: 'store-1', controlCajas: true })
    );
    prismaMock.caja.findFirst.mockResolvedValue({ id: 'caja-9', name: 'Caja 1' });
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    const resultado = await getMe('user-1');

    expect(resultado).toEqual({
      id: 'user-1',
      email: 'vendedor@servicaja.com',
      name: 'Vendedor',
      role: 'VENDEDOR',
      storeId: 'store-1',
      stores: [
        {
          storeId: 'store-1',
          name: 'Matriz Alfa',
          code: 'CODE-store-1',
          role: 'VENDEDOR',
          isPrimary: true,
        },
        {
          storeId: 'store-2',
          name: 'Sucursal Zeta',
          code: 'CODE-store-2',
          role: 'GERENTE',
          isPrimary: false,
        },
      ],
      isActive: true,
      createdAt: FECHA,
      store: { controlCajas: true, aperturaCajaConInventario: true },
      caja: { id: 'caja-9', name: 'Caja 1' },
      session: null,
    });
  });

  it('usa la primera tienda cuando ninguna es primaria', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'vendedor@servicaja.com',
      name: 'Vendedor',
      role: Role.VENDEDOR,
      isActive: true,
      createdAt: FECHA,
    });
    prismaMock.userStore.findMany.mockImplementation(async () => [
      filaTienda('store-4', 'Beta', Role.VENDEDOR),
      filaTienda('store-7', 'Alfa', Role.VENDEDOR),
    ]);
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-4' }));
    prismaMock.caja.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 'user-1',
        email: 'vendedor@servicaja.com',
        name: 'Vendedor',
        role: Role.VENDEDOR,
        isActive: true,
        createdAt: FECHA,
      })
      .mockResolvedValue({ role: Role.VENDEDOR });

    const resultado = await getMe('user-1');

    expect(resultado.storeId).toBe('store-4');
    expect(resultado.stores.map((s) => s.name)).toEqual(['Alfa', 'Beta']);
  });
});

describe('updateMe', () => {
  it('lanza USER_NOT_FOUND si el usuario no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expectApiError(() => updateMe('user-x', { name: 'X', email: 'x@x.mx' }), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('lanza EMAIL_TAKEN si el correo pertenece a otro usuario', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ ...userFixture({ id: 'user-1' }), userStores: [] })
      .mockResolvedValueOnce(userFixture({ id: 'user-2', email: 'otro@servicaja.com' }));

    await expectApiError(
      () => updateMe('user-1', { name: 'Nuevo', email: 'otro@servicaja.com' }),
      { status: 409, code: 'EMAIL_TAKEN' }
    );
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('actualiza el perfil y audita en la tienda primaria', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        ...userFixture({ id: 'user-1' }),
        userStores: [
          { storeId: 'store-2', isPrimary: false },
          { storeId: 'store-1', isPrimary: true },
        ],
      })
      // El correo buscado es el mismo usuario: no debe considerarse duplicado.
      .mockResolvedValueOnce(userFixture({ id: 'user-1', email: 'nuevo@servicaja.com' }));
    const actualizado = {
      id: 'user-1',
      email: 'nuevo@servicaja.com',
      name: 'Nuevo Nombre',
      role: 'VENDEDOR',
      isActive: true,
      createdAt: FECHA,
    };
    prismaMock.user.update.mockResolvedValue(actualizado);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await updateMe('user-1', {
      name: 'Nuevo Nombre',
      email: 'nuevo@servicaja.com',
    });

    expect(resultado).toEqual(actualizado);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { name: 'Nuevo Nombre', email: 'nuevo@servicaja.com' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'UPDATE',
        entity: 'USER',
        entityId: 'user-1',
        metadata: { changes: { name: 'Nuevo Nombre', email: 'nuevo@servicaja.com' } },
      },
    });
  });

  it('audita en la primera tienda si ninguna es primaria', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        ...userFixture({ id: 'user-1' }),
        userStores: [
          { storeId: 'store-5', isPrimary: false },
          { storeId: 'store-6', isPrimary: false },
        ],
      })
      .mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValue(userFixture({ id: 'user-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await updateMe('user-1', { name: 'Nuevo', email: 'vendedor@servicaja.com' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ storeId: 'store-5' }),
    });
  });

  it('no audita si el usuario no tiene tiendas', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ ...userFixture({ id: 'user-1' }), userStores: [] })
      .mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValue(userFixture({ id: 'user-1' }));

    await updateMe('user-1', { name: 'Nuevo', email: 'vendedor@servicaja.com' });

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('changeMyPassword', () => {
  it('lanza USER_NOT_FOUND si el usuario no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expectApiError(() => changeMyPassword('user-x', 'actual', 'nueva'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('lanza INVALID_CURRENT_PASSWORD si la contraseña actual no coincide', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...userFixture({ id: 'user-1' }),
      userStores: [],
    });
    proximoCompare(false);

    await expectApiError(() => changeMyPassword('user-1', 'mala', 'nueva'), {
      status: 401,
      code: 'INVALID_CURRENT_PASSWORD',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('lanza SAME_PASSWORD si la nueva contraseña es igual a la actual', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...userFixture({ id: 'user-1' }),
      userStores: [],
    });

    await expectApiError(() => changeMyPassword('user-1', 'igual', 'igual'), {
      status: 400,
      code: 'SAME_PASSWORD',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('hashea la nueva contraseña y audita en la tienda primaria', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...userFixture({ id: 'user-1' }),
      userStores: [
        { storeId: 'store-2', isPrimary: false },
        { storeId: 'store-1', isPrimary: true },
      ],
    });
    prismaMock.user.update.mockResolvedValue(userFixture({ id: 'user-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await changeMyPassword('user-1', 'actual', 'nueva123');

    expect(resultado).toBeUndefined();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { password: 'hash:nueva123' },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'UPDATE',
        entity: 'USER',
        entityId: 'user-1',
        metadata: { change: 'password' },
      },
    });
  });

  it('audita en la primera tienda si ninguna es primaria', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...userFixture({ id: 'user-1' }),
      userStores: [{ storeId: 'store-8', isPrimary: false }],
    });
    prismaMock.user.update.mockResolvedValue(userFixture({ id: 'user-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await changeMyPassword('user-1', 'actual', 'nueva123');

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ storeId: 'store-8' }),
    });
  });

  it('no audita si el usuario no tiene tiendas', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...userFixture({ id: 'user-1' }),
      userStores: [],
    });
    prismaMock.user.update.mockResolvedValue(userFixture({ id: 'user-1' }));

    await changeMyPassword('user-1', 'actual', 'nueva123');

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('verifyCurrentPassword', () => {
  it('lanza USER_NOT_FOUND si el usuario no existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expectApiError(() => verifyCurrentPassword('user-x', 'secreto'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('lanza INVALID_CURRENT_PASSWORD si la contraseña no coincide', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture({ id: 'user-1' }));
    proximoCompare(false);

    await expectApiError(() => verifyCurrentPassword('user-1', 'mala'), {
      status: 401,
      code: 'INVALID_CURRENT_PASSWORD',
    });
  });

  it('devuelve { valid: true } cuando la contraseña es correcta', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userFixture({ id: 'user-1' }));

    await expect(verifyCurrentPassword('user-1', 'secreto')).resolves.toEqual({ valid: true });
    expect(bcrypt.compare).toHaveBeenCalledWith('secreto', 'hash-bcrypt');
  });
});

describe('buildCajaContext', () => {
  it('devuelve valores por defecto cuando la tienda no existe ni hay caja', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);
    prismaMock.caja.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);

    const resultado = await buildCajaContext('user-1', 'store-x');

    expect(resultado).toEqual({
      store: { controlCajas: false, aperturaCajaConInventario: false },
      caja: null,
      session: null,
    });
    expect(prismaMock.cajaSession.findFirst).not.toHaveBeenCalled();
  });

  it('devuelve la sesión abierta de la caja asignada', async () => {
    prismaMock.store.findUnique.mockResolvedValue(
      storeFixture({ id: 'store-1', controlCajas: true, aperturaCajaConInventario: true })
    );
    prismaMock.caja.findFirst.mockResolvedValue({ id: 'caja-9', name: 'Caja 1' });
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());

    const resultado = await buildCajaContext('user-1', 'store-1');

    expect(resultado).toEqual({
      store: { controlCajas: true, aperturaCajaConInventario: true },
      caja: { id: 'caja-9', name: 'Caja 1' },
      session: sesionAbierta(),
    });
    expect(prismaMock.cajaSession.findFirst).toHaveBeenCalledWith({
      where: { cajaId: 'caja-9', storeId: 'store-1', status: 'OPEN' },
      select: { id: true, cajaId: true, status: true, openedAt: true },
    });
  });

  it('devuelve la caja sin sesión cuando no hay turno abierto', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-1' }));
    prismaMock.caja.findFirst.mockResolvedValue({ id: 'caja-9', name: 'Caja 1' });
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    const resultado = await buildCajaContext('user-1', 'store-1');

    expect(resultado.caja).toEqual({ id: 'caja-9', name: 'Caja 1' });
    expect(resultado.session).toBeNull();
  });

  it('busca la sesión del propio ADMIN cuando no tiene caja asignada', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-1' }));
    prismaMock.caja.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ role: Role.ADMIN });
    prismaMock.cajaSession.findFirst.mockResolvedValue(sesionAbierta());

    const resultado = await buildCajaContext('user-1', 'store-1');

    expect(resultado.session).toEqual(sesionAbierta());
    expect(prismaMock.cajaSession.findFirst).toHaveBeenCalledWith({
      where: { storeId: 'store-1', userId: 'user-1', status: 'OPEN' },
      select: { id: true, cajaId: true, status: true, openedAt: true },
    });
  });

  it('devuelve session null cuando el GERENTE sin caja tampoco tiene turno abierto', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-1' }));
    prismaMock.caja.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ role: Role.GERENTE });
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    const resultado = await buildCajaContext('user-1', 'store-1');

    expect(resultado.session).toBeNull();
  });

  it('no busca sesión cuando el usuario sin caja no es privilegiado', async () => {
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-1' }));
    prismaMock.caja.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ role: Role.VENDEDOR });

    const resultado = await buildCajaContext('user-1', 'store-1');

    expect(resultado.session).toBeNull();
    expect(prismaMock.cajaSession.findFirst).not.toHaveBeenCalled();
  });
});

describe('authorizeCajaClose', () => {
  it('entrega el token de autorización cuando un ADMIN confirma con su contraseña', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-9',
      email: 'admin@servicaja.com',
      password: 'hash-bcrypt',
      role: Role.ADMIN,
    });

    const resultado = await authorizeCajaClose('store-1', 'admin@servicaja.com', 'admin123');

    expect(resultado).toEqual({ authorized: true, authorizationToken: 'jwt:user-9' });
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: 'admin@servicaja.com',
        isActive: true,
        userStores: { some: { storeId: 'store-1' } },
      },
      select: { id: true, email: true, password: true, role: true },
    });
    expect(jwt.sign).toHaveBeenCalledWith(
      {
        userId: 'user-9',
        storeId: 'store-1',
        role: 'ADMIN',
        email: 'admin@servicaja.com',
        purpose: 'CLOSE_CAJA',
      },
      expect.any(String),
      { expiresIn: '5m' }
    );
  });

  it('autoriza también a un GERENTE', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-9',
      email: 'gerente@servicaja.com',
      password: 'hash-bcrypt',
      role: Role.GERENTE,
    });

    const resultado = await authorizeCajaClose('store-1', 'gerente@servicaja.com', 'pw');

    expect(resultado.authorized).toBe(true);
  });

  it('lanza CLOSE_CAJA_AUTHORIZATION_REQUIRED si el usuario no existe', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    await expectApiError(() => authorizeCajaClose('store-1', 'nadie@servicaja.com', 'pw'), {
      status: 403,
      code: 'CLOSE_CAJA_AUTHORIZATION_REQUIRED',
      message: /autorizar la cierre/,
    });
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('lanza CLOSE_CAJA_AUTHORIZATION_REQUIRED si la contraseña es incorrecta', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-9',
      email: 'admin@servicaja.com',
      password: 'hash-bcrypt',
      role: Role.ADMIN,
    });
    proximoCompare(false);

    await expectApiError(() => authorizeCajaClose('store-1', 'admin@servicaja.com', 'mala'), {
      status: 403,
      code: 'CLOSE_CAJA_AUTHORIZATION_REQUIRED',
    });
  });

  it('lanza CLOSE_CAJA_AUTHORIZATION_REQUIRED si el rol no es ADMIN ni GERENTE', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-9',
      email: 'vendedor@servicaja.com',
      password: 'hash-bcrypt',
      role: Role.VENDEDOR,
    });

    await expectApiError(() => authorizeCajaClose('store-1', 'vendedor@servicaja.com', 'pw'), {
      status: 403,
      code: 'CLOSE_CAJA_AUTHORIZATION_REQUIRED',
    });
  });
});

describe('authorizeCajaOpen', () => {
  it('entrega el token de autorización con purpose OPEN_CAJA', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-9',
      email: 'gerente@servicaja.com',
      password: 'hash-bcrypt',
      role: Role.GERENTE,
    });

    const resultado = await authorizeCajaOpen('store-1', 'gerente@servicaja.com', 'pw');

    expect(resultado.authorized).toBe(true);
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'OPEN_CAJA' }),
      expect.any(String),
      { expiresIn: '5m' }
    );
  });

  it('lanza OPEN_CAJA_AUTHORIZATION_REQUIRED con el mensaje de apertura', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user-9',
      email: 'vendedor@servicaja.com',
      password: 'hash-bcrypt',
      role: Role.VENDEDOR,
    });

    await expectApiError(() => authorizeCajaOpen('store-1', 'vendedor@servicaja.com', 'pw'), {
      status: 403,
      code: 'OPEN_CAJA_AUTHORIZATION_REQUIRED',
      message: /autorizar la apertura/,
    });
  });

  it('lanza OPEN_CAJA_AUTHORIZATION_REQUIRED si el usuario no existe', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    await expectApiError(() => authorizeCajaOpen('store-1', 'nadie@servicaja.com', 'pw'), {
      status: 403,
      code: 'OPEN_CAJA_AUTHORIZATION_REQUIRED',
    });
  });
});
