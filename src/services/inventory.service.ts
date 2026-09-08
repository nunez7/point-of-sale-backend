import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';

export interface InventoryFilters {
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'category' | 'quantity' | 'lowStockThreshold';
  sortOrder?: 'asc' | 'desc';
}

export async function getInventoryByStore(storeId: string, filters: InventoryFilters = {}) {
  const where: Prisma.InventoryWhereInput = { storeId };

  if (filters.search) {
    where.product = {
      name: { contains: filters.search, mode: 'insensitive' },
    };
  }

  const orderBy: Prisma.InventoryOrderByWithRelationInput[] =
    !filters.sortBy
      ? [{ product: { name: 'asc' } }]
      : filters.sortBy === 'name'
        ? [{ product: { name: filters.sortOrder ?? 'asc' } }]
        : filters.sortBy === 'category'
          ? [{ product: { category: { name: filters.sortOrder ?? 'asc' } } }, { product: { name: 'asc' } }]
          : filters.sortBy === 'lowStockThreshold'
            ? [{ lowStockThreshold: filters.sortOrder ?? 'asc' }]
            : [{ quantity: filters.sortOrder ?? 'asc' }];

  const mapRow = (inv: Prisma.InventoryGetPayload<{ include: { product: { include: { category: true } } } }>) => ({
    ...inv,
    quantity: Number(inv.quantity),
  });

  // Sin `page` se devuelve el listado completo (compatibilidad).
  if (!filters.page) {
    const inventories = await prisma.inventory.findMany({
      where,
      include: { product: { include: { category: true } } },
      orderBy,
    });
    return { inventory: inventories.map(mapRow) };
  }

  const limit = filters.limit ?? 50;
  const [inventories, total] = await prisma.$transaction([
    prisma.inventory.findMany({
      where,
      include: { product: { include: { category: true } } },
      orderBy,
      skip: (filters.page - 1) * limit,
      take: limit,
    }),
    prisma.inventory.count({ where }),
  ]);

  return {
    inventory: inventories.map(mapRow),
    total,
    page: filters.page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getLowStock(storeId: string) {
  // Filtra en BD (quantity <= lowStockThreshold por fila, no expresable en
  // Prisma where) para no traer todo el inventario y filtrar en memoria.
  const candidatos = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM "inventory"
    WHERE "storeId" = ${storeId}
      AND "quantity" <= "lowStockThreshold"
  `;
  if (candidatos.length === 0) return [];

  const inventories = await prisma.inventory.findMany({
    where: { id: { in: candidatos.map((c) => c.id) } },
    include: { product: { include: { category: true } } },
  });

  return inventories.map((inv) => ({
    ...inv,
    quantity: Number(inv.quantity),
    lowStock: true,
  }));
}

export function emitInventoryEvent(storeId: string, data: unknown): void {
  // imported lazily to avoid circular dependency issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { emitToStore } = require('../socket/socket');
  emitToStore(storeId, 'inventory:updated', data);
}