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
  controlCajas?: boolean;
  aperturaCajaConInventario?: boolean;
  autoCloseEnabled?: boolean;
  autoCloseTime?: string | null;
  autoCloseDays?: string[];
};

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

export type CreateStoreInput = {
  name: string;
  code: string;
  address?: string | null;
  representante?: string | null;
  phone?: string | null;
  rfc?: string | null;
  regimenFiscal?: string | null;
  codigoPostal?: string | null;
  notifyOutOfStock?: boolean;
  notifyLowStock?: boolean;
  controlCajas?: boolean;
  aperturaCajaConInventario?: boolean;
};

export async function createStore(data: CreateStoreInput, userId: string) {
  const existing = await prisma.store.findUnique({ where: { code: data.code } });
  if (existing) {
    throw ApiError.conflict('Ya existe una tienda con ese código', 'TIENDA_CODIGO_DUPLICADO');
  }

  return prisma.$transaction(async (tx) => {
    const store = await tx.store.create({
      data: {
        name: data.name,
        code: data.code,
        address: data.address ?? null,
        representante: data.representante ?? null,
        phone: data.phone ?? null,
        rfc: data.rfc ?? null,
        regimenFiscal: data.regimenFiscal ?? null,
        codigoPostal: data.codigoPostal ?? null,
        notifyOutOfStock: data.notifyOutOfStock ?? true,
        notifyLowStock: data.notifyLowStock ?? true,
        controlCajas: data.controlCajas ?? false,
        aperturaCajaConInventario: data.aperturaCajaConInventario ?? true,
        isActive: true,
      },
    });

    await tx.auditLog.create({
      data: {
        storeId: store.id,
        userId,
        action: 'CREATE',
        entity: 'STORE',
        entityId: store.id,
        metadata: { name: store.name, code: store.code },
      },
    });

    return store;
  });
}

export async function listMyStores(userId: string) {
  const rows = await prisma.userStore.findMany({
    where: { userId },
    select: {
      storeId: true,
      role: true,
      isPrimary: true,
      store: {
        select: { id: true, name: true, code: true, isActive: true },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { store: { name: 'asc' } }],
  });
  return rows
    .filter((r) => r.store.isActive)
    .map((r) => ({
      storeId: r.storeId,
      name: r.store.name,
      code: r.store.code,
      role: r.role,
      isPrimary: r.isPrimary,
    }));
}

export async function listAllStores() {
  return prisma.store.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      phone: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { name: 'asc' },
  });
}

export async function deleteStore(id: string, userId: string) {
  const existing = await prisma.store.findUnique({ where: { id } });
  if (!existing) {
    throw ApiError.notFound('Tienda no encontrada', 'TIENDA_NOT_FOUND');
  }

  return prisma.$transaction(async (tx) => {
    await tx.store.update({
      where: { id },
      data: { isActive: false },
    });

    await tx.auditLog.create({
      data: {
        storeId: id,
        userId,
        action: 'DELETE',
        entity: 'STORE',
        entityId: id,
        metadata: { name: existing.name, code: existing.code },
      },
    });

    return { id, message: 'Tienda desactivada' };
  });
}

export async function reactivateStore(id: string, userId: string) {
  const existing = await prisma.store.findUnique({ where: { id } });
  if (!existing) {
    throw ApiError.notFound('Tienda no encontrada', 'TIENDA_NOT_FOUND');
  }

  return prisma.$transaction(async (tx) => {
    const store = await tx.store.update({
      where: { id },
      data: { isActive: true },
    });

    await tx.auditLog.create({
      data: {
        storeId: id,
        userId,
        action: 'UPDATE',
        entity: 'STORE',
        entityId: id,
        metadata: { action: 'REACTIVATE', name: existing.name, code: existing.code },
      },
    });

    return store;
  });
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
          ...(data.controlCajas !== undefined && { controlCajas: data.controlCajas }),
          ...(data.aperturaCajaConInventario !== undefined && { aperturaCajaConInventario: data.aperturaCajaConInventario }),
          ...(data.autoCloseEnabled !== undefined && { autoCloseEnabled: data.autoCloseEnabled }),
          ...(data.autoCloseTime !== undefined && { autoCloseTime: data.autoCloseTime }),
          ...(data.autoCloseDays !== undefined && { autoCloseDays: data.autoCloseDays }),
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

export async function getAutoCloseConfig(storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { autoCloseEnabled: true, autoCloseTime: true, autoCloseDays: true },
  });
  return store ?? { autoCloseEnabled: false, autoCloseTime: null, autoCloseDays: ['1', '2', '3', '4', '5', '6'] };
}
