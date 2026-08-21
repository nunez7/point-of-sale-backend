import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';

export type UpdateStoreInput = {
  name?: string;
  code?: string;
  address?: string | null;
  representante?: string | null;
  phone?: string | null;
}

function mapearErrorCodigoDuplicado(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  ) {
    return ApiError.conflict(
      'Ya existe una tienda con esa razón social',
      'TIENDA_CODIGO_DUPLICADO'
    );
  }
  return error;
}

export async function getStoreById(id: string) {
  const store = await prisma.store.findUnique({ where: { id } });
  if (!store) {
    throw ApiError.notFound('Tienda no encontrada', 'TIENDA_NOT_FOUND');
  }
  return store;
}

export async function updateStore(id: string, data: UpdateStoreInput, userId: string) {
  const existing = await prisma.store.findUnique({ where: { id } });
  if (!existing) {
    throw ApiError.notFound('Tienda no encontrada', 'TIENDA_NOT_FOUND');
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const store = await tx.store.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.code !== undefined && { code: data.code }),
          ...(data.address !== undefined && { address: data.address }),
          ...(data.representante !== undefined && { representante: data.representante }),
          ...(data.phone !== undefined && { phone: data.phone }),
        },
      });

      await tx.auditLog.create({
        data: {
          storeId: store.id,
          userId,
          action: 'UPDATE',
          entity: 'STORE',
          entityId: store.id,
          metadata: { changes: data },
        },
      });

      return store;
    });
  } catch (error) {
    throw mapearErrorCodigoDuplicado(error);
  }
}
