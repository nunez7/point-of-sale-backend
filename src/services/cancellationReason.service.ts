import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';

export interface CancellationReasonInput {
  name: string;
  isActive?: boolean;
}

function serializeReason(reason: {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: reason.id,
    name: reason.name,
    isActive: reason.isActive,
    createdAt: reason.createdAt.toISOString(),
    updatedAt: reason.updatedAt.toISOString(),
  };
}

export async function listReasons(
  storeId: string,
  includeInactive: boolean = true
): Promise<ReturnType<typeof serializeReason>[]> {
  const where: Prisma.CancellationReasonWhereInput = { storeId };
  if (!includeInactive) where.isActive = true;

  const reasons = await prisma.cancellationReason.findMany({
    where,
    orderBy: { name: 'asc' },
  });
  return reasons.map(serializeReason);
}

export async function createReason(storeId: string, input: CancellationReasonInput) {
  const existing = await prisma.cancellationReason.findFirst({
    where: { storeId, name: input.name },
  });
  if (existing) {
    throw ApiError.conflict(
      `Ya existe un motivo con el nombre "${input.name}"`,
      'REASON_DUPLICATE'
    );
  }

  const reason = await prisma.cancellationReason.create({
    data: {
      storeId,
      name: input.name,
      isActive: input.isActive ?? true,
    },
  });
  return serializeReason(reason);
}

export async function updateReason(
  id: string,
  storeId: string,
  input: Partial<CancellationReasonInput>
) {
  const reason = await prisma.cancellationReason.findFirst({ where: { id, storeId } });
  if (!reason) {
    throw ApiError.notFound('Motivo no encontrado', 'REASON_NOT_FOUND');
  }

  if (input.name && input.name !== reason.name) {
    const dupe = await prisma.cancellationReason.findFirst({
      where: { storeId, name: input.name, NOT: { id } },
    });
    if (dupe) {
      throw ApiError.conflict(
        `Ya existe un motivo con el nombre "${input.name}"`,
        'REASON_DUPLICATE'
      );
    }
  }

  const updated = await prisma.cancellationReason.update({
    where: { id },
    data: {
      name: input.name,
      isActive: input.isActive,
    },
  });
  return serializeReason(updated);
}

export async function deleteReason(id: string, storeId: string) {
  const reason = await prisma.cancellationReason.findFirst({ where: { id, storeId } });
  if (!reason) {
    throw ApiError.notFound('Motivo no encontrado', 'REASON_NOT_FOUND');
  }

  const used = await prisma.cancellation.count({ where: { cancellationReasonId: id } });
  if (used > 0) {
    throw ApiError.conflict(
      'No se puede eliminar: el motivo ya está asociado a cancelaciones',
      'REASON_IN_USE'
    );
  }

  await prisma.cancellationReason.delete({ where: { id } });
  return { id, message: 'Motivo eliminado' };
}
