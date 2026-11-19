import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { expectApiError } from '../helpers/expectApiError';
import {
  createReason,
  deleteReason,
  listReasons,
  updateReason,
} from '../../src/services/cancellationReason.service';

const FECHA = new Date('2026-01-15T18:00:00.000Z');

function reasonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'motivo-1',
    storeId: 'store-1',
    name: 'Error de facturación',
    isActive: true,
    createdAt: FECHA,
    updatedAt: FECHA,
    ...overrides,
  };
}

describe('listReasons', () => {
  it('incluye inactivos por defecto y serializa fechas como ISO', async () => {
    prismaMock.cancellationReason.findMany.mockResolvedValue([reasonRow()]);

    const resultado = await listReasons('store-1');

    expect(prismaMock.cancellationReason.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      orderBy: { name: 'asc' },
    });
    expect(resultado).toEqual([
      {
        id: 'motivo-1',
        name: 'Error de facturación',
        isActive: true,
        createdAt: '2026-01-15T18:00:00.000Z',
        updatedAt: '2026-01-15T18:00:00.000Z',
      },
    ]);
  });

  it('filtra solo activos cuando includeInactive es false', async () => {
    prismaMock.cancellationReason.findMany.mockResolvedValue([]);

    await listReasons('store-1', false);

    expect(prismaMock.cancellationReason.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', isActive: true },
      orderBy: { name: 'asc' },
    });
  });
});

describe('createReason', () => {
  it('lanza REASON_DUPLICATE si ya existe el nombre en la tienda', async () => {
    prismaMock.cancellationReason.findFirst.mockResolvedValue(reasonRow());

    await expectApiError(() => createReason('store-1', { name: 'Error de facturación' }), {
      status: 409,
      code: 'REASON_DUPLICATE',
    });
    expect(prismaMock.cancellationReason.create).not.toHaveBeenCalled();
  });

  it('crea el motivo activo por defecto', async () => {
    prismaMock.cancellationReason.findFirst.mockResolvedValue(null);
    prismaMock.cancellationReason.create.mockResolvedValue(reasonRow());

    const resultado = await createReason('store-1', { name: 'Error de facturación' });

    expect(prismaMock.cancellationReason.create).toHaveBeenCalledWith({
      data: { storeId: 'store-1', name: 'Error de facturación', isActive: true },
    });
    expect(resultado.isActive).toBe(true);
  });

  it('respeta isActive explícito', async () => {
    prismaMock.cancellationReason.findFirst.mockResolvedValue(null);
    prismaMock.cancellationReason.create.mockResolvedValue(reasonRow({ isActive: false }));

    await createReason('store-1', { name: 'Obsoleto', isActive: false });

    expect(prismaMock.cancellationReason.create).toHaveBeenCalledWith({
      data: { storeId: 'store-1', name: 'Obsoleto', isActive: false },
    });
  });
});

describe('updateReason', () => {
  it('lanza REASON_NOT_FOUND si el motivo no pertenece a la tienda', async () => {
    prismaMock.cancellationReason.findFirst.mockResolvedValue(null);

    await expectApiError(() => updateReason('motivo-x', 'store-1', { name: 'Otro' }), {
      status: 404,
      code: 'REASON_NOT_FOUND',
    });
  });

  it('no valida duplicados cuando el nombre no cambia', async () => {
    prismaMock.cancellationReason.findFirst.mockResolvedValue(reasonRow());
    prismaMock.cancellationReason.update.mockResolvedValue(reasonRow({ isActive: false }));

    await updateReason('motivo-1', 'store-1', { name: 'Error de facturación', isActive: false });

    expect(prismaMock.cancellationReason.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.cancellationReason.update).toHaveBeenCalledWith({
      where: { id: 'motivo-1' },
      data: { name: 'Error de facturación', isActive: false },
    });
  });

  it('lanza REASON_DUPLICATE si el nombre nuevo ya existe', async () => {
    prismaMock.cancellationReason.findFirst
      .mockResolvedValueOnce(reasonRow())
      .mockResolvedValueOnce(reasonRow({ id: 'motivo-2', name: 'Duplicada' }));

    await expectApiError(() => updateReason('motivo-1', 'store-1', { name: 'Duplicada' }), {
      status: 409,
      code: 'REASON_DUPLICATE',
    });
    expect(prismaMock.cancellationReason.findFirst).toHaveBeenLastCalledWith({
      where: { storeId: 'store-1', name: 'Duplicada', NOT: { id: 'motivo-1' } },
    });
  });

  it('actualiza cuando el nombre nuevo está libre', async () => {
    prismaMock.cancellationReason.findFirst
      .mockResolvedValueOnce(reasonRow())
      .mockResolvedValueOnce(null);
    prismaMock.cancellationReason.update.mockResolvedValue(reasonRow({ name: 'Nuevo' }));

    const resultado = await updateReason('motivo-1', 'store-1', { name: 'Nuevo' });

    expect(resultado.name).toBe('Nuevo');
  });
});

describe('deleteReason', () => {
  it('lanza REASON_NOT_FOUND si no existe', async () => {
    prismaMock.cancellationReason.findFirst.mockResolvedValue(null);

    await expectApiError(() => deleteReason('motivo-x', 'store-1'), {
      status: 404,
      code: 'REASON_NOT_FOUND',
    });
  });

  it('lanza REASON_IN_USE si el motivo ya se usó en cancelaciones', async () => {
    prismaMock.cancellationReason.findFirst.mockResolvedValue(reasonRow());
    prismaMock.cancellation.count.mockResolvedValue(1);

    await expectApiError(() => deleteReason('motivo-1', 'store-1'), {
      status: 409,
      code: 'REASON_IN_USE',
    });
    expect(prismaMock.cancellationReason.delete).not.toHaveBeenCalled();
  });

  it('elimina el motivo cuando está libre', async () => {
    prismaMock.cancellationReason.findFirst.mockResolvedValue(reasonRow());
    prismaMock.cancellation.count.mockResolvedValue(0);
    prismaMock.cancellationReason.delete.mockResolvedValue(reasonRow());

    await expect(deleteReason('motivo-1', 'store-1')).resolves.toEqual({
      id: 'motivo-1',
      message: 'Motivo eliminado',
    });
    expect(prismaMock.cancellationReason.delete).toHaveBeenCalledWith({
      where: { id: 'motivo-1' },
    });
  });
});
