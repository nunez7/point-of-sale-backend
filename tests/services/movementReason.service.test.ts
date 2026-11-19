import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { expectApiError } from '../helpers/expectApiError';
import {
  createReason,
  deleteReason,
  listReasons,
  updateReason,
} from '../../src/services/movementReason.service';

const FECHA = new Date('2026-01-15T18:00:00.000Z');

function reasonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'motivo-1',
    storeId: 'store-1',
    name: 'Merma',
    tipo: 'SALIDA',
    departamento: 'Abarrotes',
    isActive: true,
    createdAt: FECHA,
    updatedAt: FECHA,
    ...overrides,
  };
}

describe('listReasons (movimientos)', () => {
  it('incluye inactivos por defecto y ordena por tipo y nombre', async () => {
    prismaMock.movementReason.findMany.mockResolvedValue([reasonRow()]);

    const resultado = await listReasons('store-1');

    expect(prismaMock.movementReason.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      orderBy: [{ tipo: 'asc' }, { name: 'asc' }],
    });
    expect(resultado[0]).toEqual({
      id: 'motivo-1',
      name: 'Merma',
      tipo: 'SALIDA',
      departamento: 'Abarrotes',
      isActive: true,
      createdAt: '2026-01-15T18:00:00.000Z',
      updatedAt: '2026-01-15T18:00:00.000Z',
    });
  });

  it('filtra solo activos cuando includeInactive es false', async () => {
    prismaMock.movementReason.findMany.mockResolvedValue([]);

    await listReasons('store-1', false);

    expect(prismaMock.movementReason.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', isActive: true },
      orderBy: [{ tipo: 'asc' }, { name: 'asc' }],
    });
  });
});

describe('createReason (movimientos)', () => {
  it('lanza REASON_DUPLICATE si el nombre ya existe', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(reasonRow());

    await expectApiError(() => createReason('store-1', { name: 'Merma', tipo: 'SALIDA' }), {
      status: 409,
      code: 'REASON_DUPLICATE',
    });
  });

  it('crea el motivo con departamento nulo y activo por defecto', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(null);
    prismaMock.movementReason.create.mockResolvedValue(reasonRow({ departamento: null }));

    const resultado = await createReason('store-1', { name: 'Merma', tipo: 'SALIDA' });

    expect(prismaMock.movementReason.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        name: 'Merma',
        tipo: 'SALIDA',
        departamento: null,
        isActive: true,
      },
    });
    expect(resultado.departamento).toBeNull();
  });

  it('respeta departamento e isActive explícitos', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(null);
    prismaMock.movementReason.create.mockResolvedValue(reasonRow({ isActive: false }));

    await createReason('store-1', {
      name: 'Reabasto',
      tipo: 'ENTRADA',
      departamento: 'Bebidas',
      isActive: false,
    });

    expect(prismaMock.movementReason.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        name: 'Reabasto',
        tipo: 'ENTRADA',
        departamento: 'Bebidas',
        isActive: false,
      },
    });
  });
});

describe('updateReason (movimientos)', () => {
  it('lanza REASON_NOT_FOUND si no existe', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(null);

    await expectApiError(() => updateReason('motivo-x', 'store-1', { name: 'Otro' }), {
      status: 404,
      code: 'REASON_NOT_FOUND',
    });
  });

  it('no comprueba duplicados si el nombre no cambia', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(reasonRow());
    prismaMock.movementReason.update.mockResolvedValue(reasonRow({ isActive: false }));

    await updateReason('motivo-1', 'store-1', { name: 'Merma', isActive: false });

    expect(prismaMock.movementReason.findFirst).toHaveBeenCalledTimes(1);
  });

  it('lanza REASON_DUPLICATE si el nombre nuevo ya existe', async () => {
    prismaMock.movementReason.findFirst
      .mockResolvedValueOnce(reasonRow())
      .mockResolvedValueOnce(reasonRow({ id: 'motivo-2', name: 'Robo' }));

    await expectApiError(() => updateReason('motivo-1', 'store-1', { name: 'Robo' }), {
      status: 409,
      code: 'REASON_DUPLICATE',
    });
  });

  it('actualiza todos los campos enviados', async () => {
    prismaMock.movementReason.findFirst
      .mockResolvedValueOnce(reasonRow())
      .mockResolvedValueOnce(null);
    prismaMock.movementReason.update.mockResolvedValue(
      reasonRow({ name: 'Robo', tipo: 'ENTRADA', departamento: null })
    );

    const resultado = await updateReason('motivo-1', 'store-1', {
      name: 'Robo',
      tipo: 'ENTRADA',
      departamento: null,
    });

    expect(prismaMock.movementReason.update).toHaveBeenCalledWith({
      where: { id: 'motivo-1' },
      data: { name: 'Robo', tipo: 'ENTRADA', departamento: null, isActive: undefined },
    });
    expect(resultado.name).toBe('Robo');
  });
});

describe('deleteReason (movimientos)', () => {
  it('lanza REASON_NOT_FOUND si no existe', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(null);

    await expectApiError(() => deleteReason('motivo-x', 'store-1'), {
      status: 404,
      code: 'REASON_NOT_FOUND',
    });
  });

  it('lanza REASON_IN_USE si hay movimientos asociados', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(reasonRow());
    prismaMock.stockMovement.count.mockResolvedValue(4);

    await expectApiError(() => deleteReason('motivo-1', 'store-1'), {
      status: 409,
      code: 'REASON_IN_USE',
    });
    expect(prismaMock.movementReason.delete).not.toHaveBeenCalled();
  });

  it('elimina el motivo cuando no tiene movimientos', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(reasonRow());
    prismaMock.stockMovement.count.mockResolvedValue(0);
    prismaMock.movementReason.delete.mockResolvedValue(reasonRow());

    await expect(deleteReason('motivo-1', 'store-1')).resolves.toEqual({
      id: 'motivo-1',
      message: 'Motivo eliminado',
    });
  });
});
