import { prisma } from '../config/prisma';

export async function getInventoryByStore(storeId: string) {
  return prisma.inventory.findMany({
    where: { storeId },
    include: {
      product: {
        include: { category: true },
      },
    },
    orderBy: { product: { name: 'asc' } },
  });
}

export async function getLowStock(storeId: string) {
  const inventories = await prisma.inventory.findMany({
    where: { storeId },
    include: { product: { include: { category: true } } },
  });

  return inventories
    .filter((inv) => inv.quantity <= inv.lowStockThreshold)
    .map((inv) => ({
      ...inv,
      lowStock: true,
    }));
}

export function emitInventoryEvent(storeId: string, data: unknown): void {
  // imported lazily to avoid circular dependency issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { emitToStore } = require('../socket/socket');
  emitToStore(storeId, 'inventory:updated', data);
}