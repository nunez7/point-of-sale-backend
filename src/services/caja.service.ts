import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import {
  assertPuedeCrearCaja,
  liberarLicenciaCaja,
  licenciaBloquea,
  reservarLicenciaCaja,
} from './license.service';

export interface CreateCajaInput {
  name: string;
  assignedUserId?: string | null;
  isActive?: boolean;
}

export interface UpdateCajaInput {
  name?: string;
  assignedUserId?: string | null;
  isActive?: boolean;
}

const cajaInclude = {
  assignedUser: { select: { id: true, name: true, email: true, role: true } },
  store: { select: { id: true, name: true } },
} satisfies Prisma.CajaInclude;

export async function listCajas(storeId: string) {
  const cajas = await prisma.caja.findMany({
    where: { storeId },
    include: cajaInclude,
    orderBy: { name: 'asc' },
  });
  return cajas;
}

export async function getCaja(id: string, storeId: string) {
  const caja = await prisma.caja.findFirst({
    where: { id, storeId },
    include: cajaInclude,
  });
  if (!caja) throw ApiError.notFound('Caja no encontrada', 'CAJA_NOT_FOUND');
  return caja;
}

async function validateAssignedUser(storeId: string, userId?: string | null) {
  if (!userId) return;
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      userStores: { some: { storeId } },
    },
  });
  if (!user) {
    throw ApiError.badRequest(
      'El usuario asignado no existe o no pertenece a la tienda',
      'ASSIGNED_USER_INVALID'
    );
  }
}

export async function createCaja(
  storeId: string,
  data: CreateCajaInput,
  userId?: string | null
) {
  await validateAssignedUser(storeId, data.assignedUserId);
  // Licenciamiento: la tienda debe tener licencia vigente y cupo de cajas.
  await assertPuedeCrearCaja(storeId);

  try {
    const caja = await prisma.caja.create({
      data: {
        storeId,
        name: data.name,
        assignedUserId: data.assignedUserId ?? null,
        isActive: data.isActive ?? true,
      },
      include: cajaInclude,
    });
    // La caja nueva consume un cupo de la licencia (si hay disponible).
    await reservarLicenciaCaja(storeId, caja.id, userId ?? null);
    return caja;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict('Ya existe una caja con ese nombre', 'CAJA_NAME_TAKEN');
    }
    throw err;
  }
}

export async function updateCaja(
  id: string,
  storeId: string,
  data: UpdateCajaInput,
  userId?: string | null
) {
  const existing = await prisma.caja.findFirst({ where: { id, storeId } });
  if (!existing) throw ApiError.notFound('Caja no encontrada', 'CAJA_NOT_FOUND');

  await validateAssignedUser(storeId, data.assignedUserId);

  try {
    const caja = await prisma.caja.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.assignedUserId !== undefined ? { assignedUserId: data.assignedUserId } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      include: cajaInclude,
    });

    // Licenciamiento: desactivar una caja libera su cupo; reactivarla lo vuelve
    // a consumir (si ya no hay cupo, en modo estricto se rechaza).
    if (data.isActive === false && existing.isActive) {
      await liberarLicenciaCaja(id);
    } else if (data.isActive === true && !existing.isActive) {
      const reservada = await reservarLicenciaCaja(storeId, id, userId ?? null);
      if (!reservada && licenciaBloquea()) {
        throw ApiError.forbidden(
          'La licencia no tiene cupo disponible para reactivar esta caja. Desactiva otra caja o amplía la licencia.',
          'LICENCIA_LIMITE_CAJAS'
        );
      }
    }

    return caja;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict('Ya existe una caja con ese nombre', 'CAJA_NAME_TAKEN');
    }
    throw err;
  }
}

export async function deleteCaja(id: string, storeId: string) {
  const existing = await prisma.caja.findFirst({ where: { id, storeId } });
  if (!existing) throw ApiError.notFound('Caja no encontrada', 'CAJA_NOT_FOUND');

  const openSession = await prisma.cajaSession.findFirst({
    where: { cajaId: id, status: 'OPEN' },
  });
  if (openSession) {
    throw ApiError.badRequest(
      'No se puede eliminar una caja con una sesión abierta. Ciérrela primero.',
      'CAJA_HAS_OPEN_SESSION'
    );
  }

  await prisma.caja.update({
    where: { id },
    data: { isActive: false },
  });
  // Al desactivar la caja se libera su cupo de licencia operativa.
  await liberarLicenciaCaja(id);
  return { id, message: 'Caja desactivada correctamente' };
}

// Devuelve la caja asignada a un usuario (si la tienda usa control de cajas).
export async function getCajaForUser(userId: string, storeId: string) {
  const caja = await prisma.caja.findFirst({
    where: { assignedUserId: userId, storeId, isActive: true },
    include: cajaInclude,
  });
  return caja;
}

// Sesión abierta de una caja (si existe).
export async function getOpenSessionForCaja(cajaId: string, storeId: string) {
  return prisma.cajaSession.findFirst({
    where: { cajaId, storeId, status: 'OPEN' },
  });
}
