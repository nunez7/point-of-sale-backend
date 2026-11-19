import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { cajaFixture, cajaSessionFixture, userFixture } from '../helpers/fixtures';
import { prismaKnownError } from '../helpers/prismaErrors';
import { expectApiError } from '../helpers/expectApiError';
import {
  createCaja,
  deleteCaja,
  getCaja,
  getCajaForUser,
  getOpenSessionForCaja,
  listCajas,
  updateCaja,
} from '../../src/services/caja.service';

describe('listCajas', () => {
  it('lista las cajas de la tienda con usuario y tienda incluidos', async () => {
    const filas = [cajaFixture()];
    prismaMock.caja.findMany.mockResolvedValue(filas);

    await expect(listCajas('store-1')).resolves.toEqual(filas);
    expect(prismaMock.caja.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      include: {
        assignedUser: { select: { id: true, name: true, email: true, role: true } },
        store: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  });
});

describe('getCaja', () => {
  it('devuelve la caja de la tienda', async () => {
    const fila = cajaFixture();
    prismaMock.caja.findFirst.mockResolvedValue(fila);

    await expect(getCaja('caja-1', 'store-1')).resolves.toEqual(fila);
  });

  it('lanza CAJA_NOT_FOUND si no existe en la tienda', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(null);

    await expectApiError(() => getCaja('caja-x', 'store-1'), {
      status: 404,
      code: 'CAJA_NOT_FOUND',
    });
  });
});

describe('createCaja', () => {
  it('valida que el usuario asignado pertenezca a la tienda', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    await expectApiError(() => createCaja('store-1', { name: 'Caja 1', assignedUserId: 'user-9' }), {
      status: 400,
      code: 'ASSIGNED_USER_INVALID',
    });
    expect(prismaMock.caja.create).not.toHaveBeenCalled();
  });

  it('crea la caja activa con usuario asignado', async () => {
    prismaMock.user.findFirst.mockResolvedValue(userFixture({ id: 'user-9' }));
    prismaMock.caja.create.mockResolvedValue(cajaFixture({ assignedUserId: 'user-9' }));

    await createCaja('store-1', { name: 'Caja 1', assignedUserId: 'user-9' });

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-9', userStores: { some: { storeId: 'store-1' } } },
    });
    expect(prismaMock.caja.create).toHaveBeenCalledWith({
      data: { storeId: 'store-1', name: 'Caja 1', assignedUserId: 'user-9', isActive: true },
      include: expect.anything(),
    });
  });

  it('no consulta usuarios cuando no se asigna ninguno', async () => {
    prismaMock.caja.create.mockResolvedValue(cajaFixture());

    await createCaja('store-1', { name: 'Caja 1', isActive: false });

    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.caja.create).toHaveBeenCalledWith({
      data: { storeId: 'store-1', name: 'Caja 1', assignedUserId: null, isActive: false },
      include: expect.anything(),
    });
  });

  it('traduce el P2002 de Prisma a CAJA_NAME_TAKEN', async () => {
    prismaMock.caja.create.mockRejectedValue(prismaKnownError('P2002'));

    await expectApiError(() => createCaja('store-1', { name: 'Repetida' }), {
      status: 409,
      code: 'CAJA_NAME_TAKEN',
    });
  });

  it('repropaga errores distintos de P2002', async () => {
    const error = prismaKnownError('P2003');
    prismaMock.caja.create.mockRejectedValue(error);

    await expect(createCaja('store-1', { name: 'Caja 1' })).rejects.toBe(error);
  });
});

describe('updateCaja', () => {
  it('lanza CAJA_NOT_FOUND si la caja no existe en la tienda', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(null);

    await expectApiError(() => updateCaja('caja-x', 'store-1', { name: 'Nueva' }), {
      status: 404,
      code: 'CAJA_NOT_FOUND',
    });
  });

  it('actualiza solo los campos enviados', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(cajaFixture());
    prismaMock.caja.update.mockResolvedValue(cajaFixture({ name: 'Nueva' }));

    await updateCaja('caja-1', 'store-1', { name: 'Nueva' });

    expect(prismaMock.caja.update).toHaveBeenCalledWith({
      where: { id: 'caja-1' },
      data: { name: 'Nueva' },
      include: expect.anything(),
    });
  });

  it('permite desasignar el usuario enviando null', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(cajaFixture());
    prismaMock.caja.update.mockResolvedValue(cajaFixture({ assignedUserId: null }));

    await updateCaja('caja-1', 'store-1', { assignedUserId: null });

    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.caja.update).toHaveBeenCalledWith({
      where: { id: 'caja-1' },
      data: { assignedUserId: null },
      include: expect.anything(),
    });
  });

  it('valida el usuario asignado cuando se envía uno', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(cajaFixture());
    prismaMock.user.findFirst.mockResolvedValue(null);

    await expectApiError(
      () => updateCaja('caja-1', 'store-1', { assignedUserId: 'user-9' }),
      { status: 400, code: 'ASSIGNED_USER_INVALID' }
    );
  });

  it('traduce el P2002 de Prisma a CAJA_NAME_TAKEN', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(cajaFixture());
    prismaMock.caja.update.mockRejectedValue(prismaKnownError('P2002'));

    await expectApiError(() => updateCaja('caja-1', 'store-1', { name: 'Repetida' }), {
      status: 409,
      code: 'CAJA_NAME_TAKEN',
    });
  });

  it('repropaga errores distintos de P2002', async () => {
    const error = prismaKnownError('P2025');
    prismaMock.caja.findFirst.mockResolvedValue(cajaFixture());
    prismaMock.caja.update.mockRejectedValue(error);

    await expect(updateCaja('caja-1', 'store-1', { name: 'Nueva' })).rejects.toBe(error);
  });
});

describe('deleteCaja', () => {
  it('lanza CAJA_NOT_FOUND si no existe', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(null);

    await expectApiError(() => deleteCaja('caja-x', 'store-1'), {
      status: 404,
      code: 'CAJA_NOT_FOUND',
    });
  });

  it('bloquea el borrado si hay una sesión abierta', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(cajaFixture());
    prismaMock.cajaSession.findFirst.mockResolvedValue(cajaSessionFixture());

    await expectApiError(() => deleteCaja('caja-1', 'store-1'), {
      status: 400,
      code: 'CAJA_HAS_OPEN_SESSION',
    });
    expect(prismaMock.caja.update).not.toHaveBeenCalled();
  });

  it('desactiva la caja en lugar de borrarla', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(cajaFixture());
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);
    prismaMock.caja.update.mockResolvedValue(cajaFixture({ isActive: false }));

    await expect(deleteCaja('caja-1', 'store-1')).resolves.toEqual({
      id: 'caja-1',
      message: 'Caja desactivada correctamente',
    });
    expect(prismaMock.caja.update).toHaveBeenCalledWith({
      where: { id: 'caja-1' },
      data: { isActive: false },
    });
  });
});

describe('getCajaForUser', () => {
  it('busca la caja activa asignada al usuario', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(null);

    await getCajaForUser('user-1', 'store-1');

    expect(prismaMock.caja.findFirst).toHaveBeenCalledWith({
      where: { assignedUserId: 'user-1', storeId: 'store-1', isActive: true },
      include: {
        assignedUser: { select: { id: true, name: true, email: true, role: true } },
        store: { select: { id: true, name: true } },
      },
    });
  });
});

describe('getOpenSessionForCaja', () => {
  it('busca la sesión abierta de la caja en la tienda', async () => {
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await getOpenSessionForCaja('caja-1', 'store-1');

    expect(prismaMock.cajaSession.findFirst).toHaveBeenCalledWith({
      where: { cajaId: 'caja-1', storeId: 'store-1', status: 'OPEN' },
    });
  });
});
