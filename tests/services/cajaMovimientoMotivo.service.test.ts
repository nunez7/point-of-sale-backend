import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { expectApiError } from '../helpers/expectApiError';
import {
  createMotivo,
  deleteMotivo,
  listMotivos,
  updateMotivo,
} from '../../src/services/cajaMovimientoMotivo.service';

function motivoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'motivo-1',
    storeId: 'store-1',
    tipo: 'INGRESO',
    name: 'Feria',
    isActive: true,
    createdAt: new Date('2026-01-15T18:00:00.000Z'),
    ...overrides,
  };
}

describe('listMotivos', () => {
  it('incluye inactivos por defecto', async () => {
    prismaMock.cajaMovimientoMotivo.findMany.mockResolvedValue([]);

    await listMotivos('store-1');

    expect(prismaMock.cajaMovimientoMotivo.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      orderBy: [{ tipo: 'asc' }, { name: 'asc' }],
    });
  });

  it('filtra solo activos cuando includeInactive es false', async () => {
    prismaMock.cajaMovimientoMotivo.findMany.mockResolvedValue([]);

    await listMotivos('store-1', false);

    expect(prismaMock.cajaMovimientoMotivo.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', isActive: true },
      orderBy: [{ tipo: 'asc' }, { name: 'asc' }],
    });
  });
});

describe('createMotivo', () => {
  it('recorta el nombre y lo usa en la búsqueda por clave compuesta', async () => {
    prismaMock.cajaMovimientoMotivo.findUnique.mockResolvedValue(null);
    prismaMock.cajaMovimientoMotivo.create.mockResolvedValue(motivoRow());

    await createMotivo('store-1', { tipo: 'INGRESO', name: '  Feria  ' });

    expect(prismaMock.cajaMovimientoMotivo.findUnique).toHaveBeenCalledWith({
      where: { storeId_name: { storeId: 'store-1', name: 'Feria' } },
    });
    expect(prismaMock.cajaMovimientoMotivo.create).toHaveBeenCalledWith({
      data: { storeId: 'store-1', tipo: 'INGRESO', name: 'Feria', isActive: true },
    });
  });

  it('lanza CAJA_MOTIVO_DUPLICADO si ya existe', async () => {
    prismaMock.cajaMovimientoMotivo.findUnique.mockResolvedValue(motivoRow());

    await expectApiError(() => createMotivo('store-1', { tipo: 'INGRESO', name: 'Feria' }), {
      status: 409,
      code: 'CAJA_MOTIVO_DUPLICADO',
    });
    expect(prismaMock.cajaMovimientoMotivo.create).not.toHaveBeenCalled();
  });

  it('respeta isActive explícito', async () => {
    prismaMock.cajaMovimientoMotivo.findUnique.mockResolvedValue(null);
    prismaMock.cajaMovimientoMotivo.create.mockResolvedValue(motivoRow({ isActive: false }));

    await createMotivo('store-1', { tipo: 'EGRESO', name: 'Retiro', isActive: false });

    expect(prismaMock.cajaMovimientoMotivo.create).toHaveBeenCalledWith({
      data: { storeId: 'store-1', tipo: 'EGRESO', name: 'Retiro', isActive: false },
    });
  });
});

describe('updateMotivo', () => {
  it('lanza CAJA_MOTIVO_NOT_FOUND si no existe en la tienda', async () => {
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue(null);

    await expectApiError(() => updateMotivo('store-1', 'motivo-x', { name: 'Otro' }), {
      status: 404,
      code: 'CAJA_MOTIVO_NOT_FOUND',
    });
  });

  it('valida duplicados solo cuando se envía nombre', async () => {
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue(motivoRow());
    prismaMock.cajaMovimientoMotivo.update.mockResolvedValue(motivoRow({ isActive: false }));

    await updateMotivo('store-1', 'motivo-1', { isActive: false });

    expect(prismaMock.cajaMovimientoMotivo.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.cajaMovimientoMotivo.update).toHaveBeenCalledWith({
      where: { id: 'motivo-1' },
      data: { isActive: false },
    });
  });

  it('lanza CAJA_MOTIVO_DUPLICADO si el nombre nuevo ya existe', async () => {
    prismaMock.cajaMovimientoMotivo.findFirst
      .mockResolvedValueOnce(motivoRow())
      .mockResolvedValueOnce(motivoRow({ id: 'motivo-2', name: 'Cambio' }));

    await expectApiError(
      () => updateMotivo('store-1', 'motivo-1', { name: '  Cambio  ' }),
      { status: 409, code: 'CAJA_MOTIVO_DUPLICADO' }
    );
  });

  it('actualiza tipo y nombre recortado', async () => {
    prismaMock.cajaMovimientoMotivo.findFirst
      .mockResolvedValueOnce(motivoRow())
      .mockResolvedValueOnce(null);
    prismaMock.cajaMovimientoMotivo.update.mockResolvedValue(
      motivoRow({ tipo: 'EGRESO', name: 'Cambio' })
    );

    await updateMotivo('store-1', 'motivo-1', { tipo: 'EGRESO', name: '  Cambio  ' });

    expect(prismaMock.cajaMovimientoMotivo.update).toHaveBeenCalledWith({
      where: { id: 'motivo-1' },
      data: { tipo: 'EGRESO', name: 'Cambio' },
    });
  });
});

describe('deleteMotivo', () => {
  it('lanza CAJA_MOTIVO_NOT_FOUND si no existe', async () => {
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue(null);

    await expectApiError(() => deleteMotivo('store-1', 'motivo-x'), {
      status: 404,
      code: 'CAJA_MOTIVO_NOT_FOUND',
    });
  });

  it('desactiva en lugar de borrar cuando el motivo está en uso', async () => {
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue(motivoRow());
    prismaMock.cajaMovimiento.count.mockResolvedValue(2);
    prismaMock.cajaMovimientoMotivo.update.mockResolvedValue(motivoRow({ isActive: false }));

    await expect(deleteMotivo('store-1', 'motivo-1')).resolves.toEqual({
      message: 'Motivo desactivado (estaba en uso)',
    });
    expect(prismaMock.cajaMovimientoMotivo.update).toHaveBeenCalledWith({
      where: { id: 'motivo-1' },
      data: { isActive: false },
    });
    expect(prismaMock.cajaMovimientoMotivo.delete).not.toHaveBeenCalled();
  });

  it('borra cuando no tiene movimientos', async () => {
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue(motivoRow());
    prismaMock.cajaMovimiento.count.mockResolvedValue(0);
    prismaMock.cajaMovimientoMotivo.delete.mockResolvedValue(motivoRow());

    await expect(deleteMotivo('store-1', 'motivo-1')).resolves.toEqual({
      message: 'Motivo eliminado',
    });
    expect(prismaMock.cajaMovimientoMotivo.delete).toHaveBeenCalledWith({
      where: { id: 'motivo-1' },
    });
  });
});
