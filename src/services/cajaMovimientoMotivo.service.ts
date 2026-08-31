import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';

export interface CajaMotivoInput {
  tipo: 'INGRESO' | 'EGRESO';
  name: string;
  isActive?: boolean;
}

export async function listMotivos(storeId: string, includeInactive = true) {
  return prisma.cajaMovimientoMotivo.findMany({
    where: {
      storeId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ tipo: 'asc' }, { name: 'asc' }],
  });
}

export async function createMotivo(storeId: string, input: CajaMotivoInput) {
  const name = input.name.trim();
  const existing = await prisma.cajaMovimientoMotivo.findUnique({
    where: { storeId_name: { storeId, name } },
  });
  if (existing) {
    throw ApiError.conflict('Ya existe un motivo con ese nombre', 'CAJA_MOTIVO_DUPLICADO');
  }

  return prisma.cajaMovimientoMotivo.create({
    data: {
      storeId,
      tipo: input.tipo,
      name,
      isActive: input.isActive ?? true,
    },
  });
}

export async function updateMotivo(
  storeId: string,
  id: string,
  input: Partial<CajaMotivoInput>
) {
  const motivo = await prisma.cajaMovimientoMotivo.findFirst({
    where: { id, storeId },
  });
  if (!motivo) throw ApiError.notFound('Motivo no encontrado', 'CAJA_MOTIVO_NOT_FOUND');

  if (input.name) {
    const name = input.name.trim();
    const existing = await prisma.cajaMovimientoMotivo.findFirst({
      where: { storeId, name, NOT: { id } },
    });
    if (existing) {
      throw ApiError.conflict('Ya existe un motivo con ese nombre', 'CAJA_MOTIVO_DUPLICADO');
    }
  }

  return prisma.cajaMovimientoMotivo.update({
    where: { id },
    data: {
      ...(input.tipo && { tipo: input.tipo }),
      ...(input.name && { name: input.name.trim() }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
}

export async function deleteMotivo(storeId: string, id: string) {
  const motivo = await prisma.cajaMovimientoMotivo.findFirst({
    where: { id, storeId },
  });
  if (!motivo) throw ApiError.notFound('Motivo no encontrado', 'CAJA_MOTIVO_NOT_FOUND');

  const usedCount = await prisma.cajaMovimiento.count({
    where: { motivoId: id },
  });
  if (usedCount > 0) {
    await prisma.cajaMovimientoMotivo.update({
      where: { id },
      data: { isActive: false },
    });
    return { message: 'Motivo desactivado (estaba en uso)' };
  }

  await prisma.cajaMovimientoMotivo.delete({ where: { id } });
  return { message: 'Motivo eliminado' };
}
