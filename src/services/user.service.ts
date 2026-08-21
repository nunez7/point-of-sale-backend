import { prisma } from '../config/prisma';
import bcrypt from 'bcryptjs';
import { Role, Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';

export async function listUsers(storeId: string) {
  return prisma.user.findMany({
    where: { storeId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      storeId: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
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
        storeId: data.storeId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        storeId: true,
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
        metadata: { email: user.email, role: user.role },
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
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');

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
        storeId: true,
        isActive: true,
      },
    });

    await tx.auditLog.create({
      data: {
        storeId: user.storeId,
        userId: actorId,
        action: 'UPDATE',
        entity: 'USER',
        entityId: user.id,
        metadata: { changes: data } as unknown as Prisma.InputJsonValue,
      },
    });

    return user;
  });
}

export async function deleteUser(id: string, actorId: string) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');

  if (existing.role === 'ADMIN' && existing.id === actorId) {
    throw ApiError.badRequest('No puedes eliminar tu propio usuario', 'CANNOT_DELETE_SELF');
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: { isActive: false },
    });

    await tx.auditLog.create({
      data: {
        storeId: user.storeId,
        userId: actorId,
        action: 'DELETE',
        entity: 'USER',
        entityId: user.id,
        metadata: { email: user.email },
      },
    });

    return { id: user.id, message: 'Usuario desactivado' };
  });
}