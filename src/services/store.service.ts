import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';

export type UpdateStoreInput = {
  name?: string;
  code?: string;
  address?: string | null;
  representante?: string | null;
  phone?: string | null;
  rfc?: string | null;
  regimenFiscal?: string | null;
  codigoPostal?: string | null;
  notifyOutOfStock?: boolean;
  notifyLowStock?: boolean;
}

function mapearErrorCodigoDuplicado(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  ) {
    return ApiError.conflict(
      'Ya existe una tienda con ese código',
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

export async function updateStore(
  id: string,
  data: UpdateStoreInput,
  userId: string,
  action = 'UPDATE'
) {
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
          ...(data.rfc !== undefined && { rfc: data.rfc }),
          ...(data.regimenFiscal !== undefined && { regimenFiscal: data.regimenFiscal }),
           ...(data.codigoPostal !== undefined && { codigoPostal: data.codigoPostal }),
           ...(data.notifyOutOfStock !== undefined && { notifyOutOfStock: data.notifyOutOfStock }),
           ...(data.notifyLowStock !== undefined && { notifyLowStock: data.notifyLowStock }),
         },
      });

      await tx.auditLog.create({
        data: {
          storeId: store.id,
          userId,
          action,
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
