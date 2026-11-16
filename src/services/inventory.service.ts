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

  const mapRow = (
    inv: Prisma.InventoryGetPayload<{ include: { product: { include: { category: true } } } }>,
    lotes?: { nextExpirationDate: string | null; lotsCount: number }
  ) => ({
    ...inv,
    quantity: Number(inv.quantity),
    // Próxima caducidad entre los lotes con saldo (para la columna "Vence").
    nextExpirationDate: lotes?.nextExpirationDate ?? null,
    lotsCount: lotes?.lotsCount ?? 0,
  });

  // Sin `page` se devuelve el listado completo (compatibilidad).
  if (!filters.page) {
    const inventories = await prisma.inventory.findMany({
      where,
      include: { product: { include: { category: true } } },
      orderBy,
    });
    const caducidades = await mapaCaducidades(
      storeId,
      inventories.map((i) => i.productId)
    );
    return { inventory: inventories.map((inv) => mapRow(inv, caducidades.get(inv.productId))) };
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

  const caducidades = await mapaCaducidades(
    storeId,
    inventories.map((i) => i.productId)
  );

  return {
    inventory: inventories.map((inv) => mapRow(inv, caducidades.get(inv.productId))),
    total,
    page: filters.page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

// Próxima caducidad y número de lotes con saldo por producto (una sola query
// para toda la página del inventario).
async function mapaCaducidades(storeId: string, productIds: string[]) {
  const mapa = new Map<string, { nextExpirationDate: string | null; lotsCount: number }>();
  if (productIds.length === 0) return mapa;

  const lotes = await prisma.inventoryLot.groupBy({
    by: ['productId'],
    where: {
      storeId,
      productId: { in: productIds },
      availableQty: { gt: 0 },
      expirationDate: { not: null },
    },
    _min: { expirationDate: true },
    _count: { _all: true },
  });

  for (const lote of lotes) {
    mapa.set(lote.productId, {
      nextExpirationDate: lote._min.expirationDate
        ? lote._min.expirationDate.toISOString().slice(0, 10)
        : null,
      lotsCount: lote._count._all,
    });
  }
  return mapa;
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