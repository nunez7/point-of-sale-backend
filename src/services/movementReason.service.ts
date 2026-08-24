import { prisma } from '../config/prisma';
import { MovementTipo, Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';

export interface MovementReasonInput {
  name: string;
  tipo: MovementTipo;
  departamento?: string | null;
  isActive?: boolean;
}

function serializeReason(reason: {
  id: string;
  name: string;
  tipo: MovementTipo;
  departamento: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: reason.id,
    name: reason.name,
    tipo: reason.tipo,
    departamento: reason.departamento,
    isActive: reason.isActive,
    createdAt: reason.createdAt.toISOString(),
    updatedAt: reason.updatedAt.toISOString(),
  };
}

export async function listReasons(
  storeId: string,
  includeInactive: boolean = true
): Promise<ReturnType<typeof serializeReason>[]> {
  const where: Prisma.MovementReasonWhereInput = { storeId };
  if (!includeInactive) where.isActive = true;

  const reasons = await prisma.movementReason.findMany({
    where,
    orderBy: [{ tipo: 'asc' }, { name: 'asc' }],
  });
  return reasons.map(serializeReason);
}

export async function createReason(storeId: string, input: MovementReasonInput) {
  const existing = await prisma.movementReason.findFirst({
    where: { storeId, name: input.name },
  });
  if (existing) {
    throw ApiError.conflict(
      `Ya existe un motivo con el nombre "${input.name}"`,
      'REASON_DUPLICATE'
    );
  }

  const reason = await prisma.movementReason.create({
    data: {
      storeId,
      name: input.name,
      tipo: input.tipo,
      departamento: input.departamento ?? null,
      isActive: input.isActive ?? true,
    },
  });
  return serializeReason(reason);
}

export async function updateReason(
  id: string,
  storeId: string,
  input: Partial<MovementReasonInput>
) {
  const reason = await prisma.movementReason.findFirst({ where: { id, storeId } });
  if (!reason) {
    throw ApiError.notFound('Motivo no encontrado', 'REASON_NOT_FOUND');
  }

  if (input.name && input.name !== reason.name) {
    const dupe = await prisma.movementReason.findFirst({
      where: { storeId, name: input.name, NOT: { id } },
    });
    if (dupe) {
      throw ApiError.conflict(
        `Ya existe un motivo con el nombre "${input.name}"`,
        'REASON_DUPLICATE'
      );
    }
  }

  const updated = await prisma.movementReason.update({
    where: { id },
    data: {
      name: input.name,
      tipo: input.tipo,
      departamento: input.departamento,
      isActive: input.isActive,
    },
  });
  return serializeReason(updated);
}

export async function deleteReason(id: string, storeId: string) {
  const reason = await prisma.movementReason.findFirst({ where: { id, storeId } });
  if (!reason) {
    throw ApiError.notFound('Motivo no encontrado', 'REASON_NOT_FOUND');
  }

  const used = await prisma.stockMovement.count({ where: { reasonId: id } });
  if (used > 0) {
    throw ApiError.conflict(
      'No se puede eliminar: el motivo ya está asociado a movimientos de inventario',
      'REASON_IN_USE'
    );
  }

  await prisma.movementReason.delete({ where: { id } });
  return { id, message: 'Motivo eliminado' };
}
