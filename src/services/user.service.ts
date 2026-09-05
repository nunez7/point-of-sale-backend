import { prisma } from '../config/prisma';
import bcrypt from 'bcryptjs';
import { Role, Prisma } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';

export async function listUsers(storeId: string) {
  const users = await prisma.user.findMany({
    where: {
      userStores: { some: { storeId } },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      userStores: {
        where: { storeId },
        select: {
          storeId: true,
          role: true,
          isPrimary: true,
          store: { select: { id: true, name: true, code: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return users.map((u) => ({
    ...u,
    userStores: u.userStores.map((us) => ({
      storeId: us.storeId,
      role: us.role,
      isPrimary: us.isPrimary,
      name: us.store.name,
      code: us.store.code,
    })),
  }));
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role: Role;
  storeId: string;
}

export async function createUser(data: CreateUserInput, actorId: string) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw ApiError.conflict('El email ya está registrado', 'EMAIL_TAKEN');

  const store = await prisma.store.findUnique({ where: { id: data.storeId } });
  if (!store) throw ApiError.notFound('Tienda no encontrada', 'STORE_NOT_FOUND');

  const hashed = await bcrypt.hash(data.password, 10);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        password: hashed,
        name: data.name,
        role: data.role,
        userStores: {
          create: {
            storeId: data.storeId,
            role: data.role,
            isPrimary: true,
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });

    await tx.auditLog.create({
      data: {
        storeId: data.storeId,
        userId: actorId,
        action: 'CREATE',
        entity: 'USER',
        entityId: user.id,
        metadata: { email: user.email, role: user.role, storeId: data.storeId },
      },
    });

    return user;
  });
}

export interface UpdateUserInput {
  email?: string;
  password?: string;
  name?: string;
  role?: Role;
  isActive?: boolean;
}

export async function updateUser(id: string, data: UpdateUserInput, actorId: string) {
  const existing = await prisma.user.findUnique({
    where: { id },
    include: { userStores: { where: { isPrimary: true }, select: { storeId: true } } },
  });
  if (!existing) throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');

  if (existing.role === 'SOPORTE' && existing.id !== actorId) {
    throw ApiError.forbidden(
      'Los usuarios con rol SOPORTE no pueden ser editados',
      'SUPPORT_USER_PROTECTED'
    );
  }

  const updateData: Record<string, unknown> = {};
  if (data.email !== undefined) updateData.email = data.email;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.role !== undefined) updateData.role = data.role;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.password) updateData.password = await bcrypt.hash(data.password, 10);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });

    const fallback = existing.userStores[0]?.storeId ?? '';
    if (fallback) {
      await tx.auditLog.create({
        data: {
          storeId: fallback,
          userId: actorId,
          action: 'UPDATE',
          entity: 'USER',
          entityId: user.id,
          metadata: { changes: data } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return user;
  });
}

export async function deleteUser(id: string, actorId: string) {
  const existing = await prisma.user.findUnique({
    where: { id },
    include: { userStores: { where: { isPrimary: true }, select: { storeId: true } } },
  });
  if (!existing) throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');

  if (existing.role === 'ADMIN' && existing.id === actorId) {
    throw ApiError.badRequest('No puedes eliminar tu propio usuario', 'CANNOT_DELETE_SELF');
  }

  if (existing.role === 'SOPORTE') {
    throw ApiError.forbidden(
      'Los usuarios con rol SOPORTE no pueden ser desactivados',
      'SUPPORT_USER_PROTECTED'
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { isActive: false },
    });

    const fallback = existing.userStores[0]?.storeId ?? '';
    if (fallback) {
      await tx.auditLog.create({
        data: {
          storeId: fallback,
          userId: actorId,
          action: 'DELETE',
          entity: 'USER',
          entityId: id,
          metadata: { email: existing.email },
        },
      });
    }

    return { id, message: 'Usuario desactivado' };
  });
}

export interface SetUserStoresInput {
  stores: Array<{ storeId: string; role: Role; isPrimary?: boolean }>;
}

export async function setUserStores(userId: string, data: SetUserStoresInput, actorId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');

  if (user.role === 'SOPORTE' && user.id !== actorId) {
    throw ApiError.forbidden(
      'Los usuarios con rol SOPORTE no pueden ser modificados',
      'SUPPORT_USER_PROTECTED'
    );
  }

  if (!data.stores.length) {
    throw ApiError.badRequest(
      'El usuario debe tener al menos una tienda asignada',
      'USER_MUST_HAVE_STORES'
    );
  }

  const storeIds = data.stores.map((s) => s.storeId);
  const stores = await prisma.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true },
  });
  if (stores.length !== storeIds.length) {
    throw ApiError.notFound('Alguna tienda no existe', 'STORE_NOT_FOUND');
  }

  return prisma.$transaction(async (tx) => {
    await tx.userStore.deleteMany({ where: { userId } });

    await tx.userStore.createMany({
      data: data.stores.map((s) => ({
        userId,
        storeId: s.storeId,
        role: s.role,
        isPrimary: s.isPrimary ?? false,
      })),
    });

    const fallback = data.stores.find((s) => s.isPrimary)?.storeId ?? data.stores[0].storeId;

    await tx.auditLog.create({
      data: {
        storeId: fallback,
        userId: actorId,
        action: 'UPDATE',
        entity: 'USER',
        entityId: userId,
        metadata: { action: 'SET_USER_STORES', stores: data.stores },
      },
    });

    return { id: userId, stores: data.stores };
  });
}