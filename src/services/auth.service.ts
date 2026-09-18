import { prisma } from '../config/prisma';
import { env } from '../config/env';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { JwtPayload } from '../types';
import { Role } from '../../generated/prisma/client.js';
import { sha256 } from '../utils/tokenHash';

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

interface UserStoreRow {
  storeId: string;
  role: Role;
  isPrimary: boolean;
}

async function loadUserStores(userId: string): Promise<UserStoreRow[]> {
  return prisma.userStore.findMany({
    where: { userId },
    select: { storeId: true, role: true, isPrimary: true },
  });
}

async function buildUserStoresDetail(userId: string) {
  const rows = await prisma.userStore.findMany({
    where: { userId },
    select: {
      storeId: true,
      role: true,
      isPrimary: true,
      store: { select: { id: true, name: true, code: true } },
    },
  });
  return rows
    .sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return a.store.name.localeCompare(b.store.name);
    })
    .map((r) => ({
      storeId: r.storeId,
      name: r.store.name,
      code: r.store.code,
      role: r.role,
      isPrimary: r.isPrimary,
    }));
}

function pickInitialStoreId(stores: UserStoreRow[]): string | null {
  if (!stores.length) return null;
  const primary = stores.find((s) => s.isPrimary);
  return (primary ?? stores[0]).storeId;
}

function publicUserShape(
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
  },
  storeId: string | null,
  stores: { storeId: string; name: string; code: string; role: Role; isPrimary: boolean }[]
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    storeId,
    stores,
  };
}

// Contexto de caja del usuario: caja asignada (si la tienda usa control de
// cajas), sesión abierta actual y configuración de la tienda. Permite al
// frontend enlazar la caja automáticamente sin importar el equipo.
export async function buildCajaContext(userId: string, storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { controlCajas: true, aperturaCajaConInventario: true },
  });

  const caja = await prisma.caja.findFirst({
    where: { assignedUserId: userId, storeId, isActive: true },
    select: { id: true, name: true },
  });

  let session: { id: string; cajaId: string; status: string; openedAt: Date } | null = null;
  if (caja) {
    const open = await prisma.cajaSession.findFirst({
      where: { cajaId: caja.id, storeId, status: 'OPEN' },
      select: { id: true, cajaId: true, status: true, openedAt: true },
    });
    if (open) session = open;
  } else {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user && (user.role === Role.ADMIN || user.role === Role.GERENTE)) {
      const open = await prisma.cajaSession.findFirst({
        where: { storeId, userId, status: 'OPEN' },
        select: { id: true, cajaId: true, status: true, openedAt: true },
      });
      if (open) session = open;
    }
  }

  return {
    store: {
      controlCajas: store?.controlCajas ?? false,
      aperturaCajaConInventario: store?.aperturaCajaConInventario ?? false,
    },
    caja,
    session,
  };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw ApiError.unauthorized('Credenciales inválidas', 'INVALID_CREDENTIALS');
  }
  if (!user.isActive) {
    throw ApiError.forbidden('Usuario inactivo', 'USER_INACTIVE');
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw ApiError.unauthorized('Credenciales inválidas', 'INVALID_CREDENTIALS');
  }

  const userStores = await loadUserStores(user.id);
  if (!userStores.length) {
    throw ApiError.forbidden(
      'El usuario no tiene tiendas asignadas',
      'USER_HAS_NO_STORES'
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const activeStoreId = pickInitialStoreId(userStores)!;
  const activeStoreRow = userStores.find((s) => s.storeId === activeStoreId)!;

  const tokenPayload: JwtPayload = {
    userId: user.id,
    storeId: activeStoreId,
    role: activeStoreRow.role,
    email: user.email,
    name: user.name,
    isActive: user.isActive,
    stores: userStores.map((s) => ({ storeId: s.storeId, role: s.role })),
  };

  const accessToken = signToken(tokenPayload);

  await audit({
    storeId: activeStoreId,
    userId: user.id,
    action: 'LOGIN',
    entity: 'USER',
    entityId: user.id,
    metadata: { email: user.email },
  });

  const storesDetail = await buildUserStoresDetail(user.id);
  const publicUser = publicUserShape(user, activeStoreId, storesDetail);

  const cajaContext = await buildCajaContext(user.id, activeStoreId);

  return { token: accessToken, user: publicUser, ...cajaContext };
}

export async function selectStore(userId: string, storeId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
  if (!user) {
    throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
  }
  if (!user.isActive) {
    throw ApiError.forbidden('Usuario inactivo', 'USER_INACTIVE');
  }

  // Verifica que la tienda exista y esté activa.
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, isActive: true },
  });
  if (!store) {
    throw ApiError.notFound('Tienda no encontrada', 'STORE_NOT_FOUND');
  }
  if (!store.isActive) {
    throw ApiError.forbidden('Tienda inactiva', 'STORE_INACTIVE');
  }

  // ADMIN/GERENTE pueden definir cualquier tienda activa como contexto de sesión.
  // VENDEDOR (u otros roles) solo pueden seleccionar tiendas donde tienen membresía.
  const membership = await prisma.userStore.findUnique({
    where: { userId_storeId: { userId: user.id, storeId } },
  });

  const isPrivileged = user.role === Role.ADMIN || user.role === Role.GERENTE;
  if (!membership && !isPrivileged) {
    throw ApiError.forbidden(
      'No tienes acceso a esa tienda',
      'STORE_ACCESS_DENIED'
    );
  }

  const userStores = await loadUserStores(user.id);

  const tokenPayload: JwtPayload = {
    userId: user.id,
    storeId,
    role: membership?.role ?? user.role,
    email: user.email,
    name: user.name,
    isActive: user.isActive,
    stores: userStores.map((s) => ({ storeId: s.storeId, role: s.role })),
  };

  const accessToken = signToken(tokenPayload);

  await audit({
    storeId,
    userId: user.id,
    action: 'SELECT_STORE',
    entity: 'USER',
    entityId: user.id,
    metadata: { storeId, privileged: isPrivileged && !membership },
  });

  // Si no es miembro, sus `stores` se mantienen (membresías reales) y
  // `storeId` representa la tienda "definida" actual para esta sesión.
  const storesDetail = await buildUserStoresDetail(user.id);
  const publicUser = publicUserShape(user, storeId, storesDetail);
  const cajaContext = await buildCajaContext(user.id, storeId);

  return { token: accessToken, user: publicUser, ...cajaContext };
}

export async function logout(userId: string, token: string): Promise<void> {
  if (token) {
    await prisma.revokedToken.create({
      data: {
        tokenHash: sha256(token),
        userId: userId || null,
        expiresAt: new Date(Date.now() + 60 * 60 * 8 * 1000),
      },
    });
  }
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      const stores = await loadUserStores(userId);
      const fallback = stores[0]?.storeId;
      if (fallback) {
        await audit({
          storeId: fallback,
          userId: user.id,
          action: 'LOGOUT',
          entity: 'USER',
          entityId: user.id,
        });
      }
    }
  }
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
  }

  const userStores = await loadUserStores(userId);
  if (!userStores.length) {
    throw ApiError.forbidden(
      'El usuario no tiene tiendas asignadas',
      'USER_HAS_NO_STORES'
    );
  }

  const activeStoreId =
    userStores.find((s) => s.isPrimary)?.storeId ?? userStores[0].storeId;

  const storesDetail = await buildUserStoresDetail(userId);
  const cajaContext = await buildCajaContext(userId, activeStoreId);

  return {
    ...publicUserShape(user, activeStoreId, storesDetail),
    isActive: user.isActive,
    createdAt: user.createdAt,
    ...cajaContext,
  };
}

export async function updateMe(
  userId: string,
  data: { name: string; email: string }
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userStores: { select: { storeId: true, isPrimary: true } } },
  });
  if (!user) {
    throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing && existing.id !== userId) {
    throw ApiError.conflict('El email ya está registrado', 'EMAIL_TAKEN');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { name: data.name, email: data.email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  const fallback = user.userStores.find((s) => s.isPrimary)?.storeId ?? user.userStores[0]?.storeId ?? '';
  if (fallback) {
    await audit({
      storeId: fallback,
      userId: user.id,
      action: 'UPDATE',
      entity: 'USER',
      entityId: user.id,
      metadata: { changes: { name: data.name, email: data.email } },
    });
  }

  return updated;
}

export async function changeMyPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userStores: { select: { storeId: true, isPrimary: true } } },
  });
  if (!user) {
    throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    throw ApiError.unauthorized(
      'La contraseña actual es incorrecta',
      'INVALID_CURRENT_PASSWORD'
    );
  }

  if (currentPassword === newPassword) {
    throw ApiError.badRequest(
      'La nueva contraseña debe ser diferente a la actual',
      'SAME_PASSWORD'
    );
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  });

  const fallback =
    user.userStores.find((s) => s.isPrimary)?.storeId ?? user.userStores[0]?.storeId ?? '';
  if (fallback) {
    await audit({
      storeId: fallback,
      userId: user.id,
      action: 'UPDATE',
      entity: 'USER',
      entityId: user.id,
      metadata: { change: 'password' },
    });
  }
}

export async function verifyCurrentPassword(userId: string, currentPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw ApiError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    throw ApiError.unauthorized(
      'La contraseña actual es incorrecta',
      'INVALID_CURRENT_PASSWORD'
    );
  }

  return { valid: true };
}

export async function authorizeCajaClose(
  storeId: string,
  email: string,
  password: string
) {
  const user = await prisma.user.findFirst({
    where: {
      email,
      isActive: true,
      userStores: { some: { storeId } },
    },
    select: { id: true, email: true, password: true, role: true },
  });
  const valid = user ? await bcrypt.compare(password, user.password) : false;
  if (!valid || (user?.role !== Role.ADMIN && user?.role !== Role.GERENTE)) {
    throw ApiError.forbidden(
      'Solo un administrador o gerente puede autorizar el cierre',
      'CLOSE_CAJA_AUTHORIZATION_REQUIRED'
    );
  }

  const authorizationToken = jwt.sign(
    {
      userId: user!.id,
      storeId,
      role: user!.role,
      email: user!.email,
      purpose: 'CLOSE_CAJA',
    },
    env.JWT_SECRET,
    { expiresIn: '5m' }
  );

  return { authorized: true, authorizationToken };
}

export async function authorizeCajaOpen(
  storeId: string,
  email: string,
  password: string
) {
  const user = await prisma.user.findFirst({
    where: {
      email,
      isActive: true,
      userStores: { some: { storeId } },
    },
    select: { id: true, email: true, password: true, role: true },
  });
  const valid = user ? await bcrypt.compare(password, user.password) : false;
  if (!valid || (user?.role !== Role.ADMIN && user?.role !== Role.GERENTE)) {
    throw ApiError.forbidden(
      'Solo un administrador o gerente puede autorizar la apertura',
      'OPEN_CAJA_AUTHORIZATION_REQUIRED'
    );
  }

  const authorizationToken = jwt.sign(
    {
      userId: user!.id,
      storeId,
      role: user!.role,
      email: user!.email,
      purpose: 'OPEN_CAJA',
    },
    env.JWT_SECRET,
    { expiresIn: '5m' }
  );

  return { authorized: true, authorizationToken };
}