import { prisma } from '../config/prisma';

export type StockAlertType = 'OUT_OF_STOCK' | 'LOW_STOCK';

export interface StockAlertPayload {
  storeId: string;
  productId: string;
  productName: string;
  quantity: number;
  type: StockAlertType;
  threshold: number;
  at: string;
}

interface CheckArgs {
  // Saldo antes del movimiento. Si no se conoce, se deriva con `delta`.
  before?: number;
  // Magnitud del cambio de stock (positiva).
  delta?: number;
  // true si el movimiento restó stock (venta, salida); false si sumó (reabasto).
  decrease?: boolean;
}

// Evalúa si un cambio de inventario cruza a un estado de alerta (agotado o
// bajo) según la configuración de la tienda, y emite `inventory:alert` a
// toda la tienda. Solo alerta en el cruce descendente para evitar ruido.
export async function checkStockAlert(
  storeId: string,
  productId: string,
  args: CheckArgs = {}
): Promise<void> {
  const inventory = await prisma.inventory.findUnique({
    where: { storeId_productId: { storeId, productId } },
    include: {
      product: { select: { name: true } },
      store: { select: { notifyOutOfStock: true, notifyLowStock: true } },
    },
  });
  if (!inventory) return;

  const qty = Number(inventory.quantity);
  const threshold = inventory.lowStockThreshold;

  let before = args.before;
  if (before === undefined) {
    if (args.delta !== undefined) {
      before = args.decrease ? qty + args.delta : qty - args.delta;
    } else {
      before = qty;
    }
  }

  let type: StockAlertType | null = null;
  if (qty <= 0 && before > 0 && inventory.store.notifyOutOfStock) {
    type = 'OUT_OF_STOCK';
  } else if (
    qty > 0 &&
    qty <= threshold &&
    before > threshold &&
    inventory.store.notifyLowStock
  ) {
    type = 'LOW_STOCK';
  }

  if (!type) return;

  const payload: StockAlertPayload = {
    storeId,
    productId,
    productName: inventory.product.name,
    quantity: qty,
    type,
    threshold,
    at: new Date().toISOString(),
  };

  // Lazy require para evitar dependencia circular con socket.ts.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { emitToStore } = require('../socket/socket');
  emitToStore(storeId, 'inventory:alert', payload);
}

// Lista los productos actualmente en estado de alerta según la configuración
// de la tienda. Alimenta el badge/contador del frontend.
export async function getStockAlerts(storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { notifyOutOfStock: true, notifyLowStock: true },
  });
  if (!store) return [];

  const inventories = await prisma.inventory.findMany({
    where: { storeId },
    include: { product: { select: { name: true, sku: true } } },
  });

  const alerts: Array<{
    productId: string;
    productName: string;
    sku: string | null;
    quantity: number;
    threshold: number;
    type: StockAlertType;
  }> = [];

  for (const inv of inventories) {
    const qty = Number(inv.quantity);
    if (qty <= 0 && store.notifyOutOfStock) {
      alerts.push({
        productId: inv.productId,
        productName: inv.product.name,
        sku: inv.product.sku,
        quantity: qty,
        threshold: inv.lowStockThreshold,
        type: 'OUT_OF_STOCK',
      });
    } else if (qty > 0 && qty <= inv.lowStockThreshold && store.notifyLowStock) {
      alerts.push({
        productId: inv.productId,
        productName: inv.product.name,
        sku: inv.product.sku,
        quantity: qty,
        threshold: inv.lowStockThreshold,
        type: 'LOW_STOCK',
      });
    }
  }

  return alerts;
}
