import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';

export async function getInventoryByStore(storeId: string) {
  const inventories = await prisma.inventory.findMany({
    where: { storeId },
    include: {
      product: {
        include: { category: true },
      },
    },
    orderBy: { product: { name: 'asc' } },
  });

  // Decimal → número al borde del servicio para que el frontend lo consuma.
  return inventories.map((inv) => ({ ...inv, quantity: Number(inv.quantity) }));
}

export async function getLowStock(storeId: string) {
  const inventories = await prisma.inventory.findMany({
    where: { storeId },
    include: { product: { include: { category: true } } },
  });

  return inventories
    .filter((inv) => new Prisma.Decimal(inv.quantity).lessThanOrEqualTo(inv.lowStockThreshold))
    .map((inv) => ({
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