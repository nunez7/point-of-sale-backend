import { prisma } from '../config/prisma';
import { Prisma, PaymentMethod } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import { SaleItemInput } from '../types';
import { mexicoStartOfDay, mexicoEndOfDay } from '../utils/dates';
import { resolvePromotionsForSale, applyPromotionResolutionToSaleTx, revertPromotionApplicationsForSale } from './promotion.service';

export interface CreateSaleInput {
  storeId: string;
  userId: string;
  items: SaleItemInput[];
  paymentMethod: string;
  discount: number;
  // COMPLETED = venta inmediata (descuenta inventario); PENDING = pedido
  // (solo valida stock, no descuenta hasta confirmarse).
  status?: 'COMPLETED' | 'PENDING';
  // Pedido: cliente asociado y notas libres (opcionales).
  clienteId?: string | null;
  notes?: string | null;
  // Sesión de caja que procesa la venta (corte de caja).
  cajaSessionId?: string | null;
  // Efectivo recibido y cambio entregado (ticket impreso). Solo en CASH.
  received?: number | null;
  change?: number | null;
}

export interface SaleResult {
  id: string;
  saleNumber: string;
  total: number;
  profit: number;
  profitMargin: number;
  status: string;
}

type Tx = Prisma.TransactionClient;

// Etiqueta corta para el snapshot de la línea de venta ("u", "kg", "L").
function etiquetaUnidad(unidadVenta: string): string {
  switch (unidadVenta) {
    case 'PESO':
      return 'kg';
    case 'VOLUMEN':
      return 'L';
    default:
      return 'u';
  }
}

async function generateSaleNumber(tx: Tx, storeId: string, code: string): Promise<string> {
  const store = await tx.store.update({
    where: { id: storeId },
    data: { saleSequence: { increment: 1 } },
  });
  return `${code}-${String(store.saleSequence).padStart(4, '0')}`;
}

// ── Batch inventory helpers ───────────────────────────────────────────
// Valida stock de todos los items en una sola query y retorna el mapa de
// disponibles. Lanza INSUFFICIENT_STOCK si alguno no cumple.
async function validateStockBatch(
  tx: Tx,
  storeId: string,
  items: { productId: string; quantity: Prisma.Decimal; name?: string }[]
): Promise<Map<string, Prisma.Decimal>> {
  const productIds = items.map((i) => i.productId);
  const rows = await tx.inventory.findMany({
    where: { storeId, productId: { in: productIds } },
    select: { productId: true, quantity: true },
  });
  const stockMap = new Map(rows.map((r) => [r.productId, r.quantity]));
  for (const item of items) {
    const available = stockMap.get(item.productId) ?? new Prisma.Decimal(0);
    if (available.lessThan(item.quantity)) {
      const label = item.name ?? item.productId;
      throw ApiError.badRequest(
        `Stock insuficiente para "${label}" (disponible: ${Number(available)})`,
        'INSUFFICIENT_STOCK'
      );
    }
  }
  return stockMap;
}

// Descuenta inventario de cada item. Se mantiene en loop por la condición
// optimista `quantity >= requested` que debe ser por-fila.
async function decrementStockBatch(
  tx: Tx,
  storeId: string,
  items: { productId: string; quantity: Prisma.Decimal }[]
): Promise<void> {
  for (const item of items) {
    const updated = await tx.inventory.updateMany({
      where: { storeId, productId: item.productId, quantity: { gte: item.quantity } },
      data: { quantity: { decrement: item.quantity } },
    });
    if (updated.count === 0) {
      throw ApiError.badRequest('Stock insuficiente al deducir inventario', 'INSUFFICIENT_STOCK');
    }
  }
}

// Restaura inventario (cancelación). Usa updateMany con `in` para reducir
// round-trips: si el registro existe lo incrementa; si no, Prisma crea
// la fila con el valor inicial. Como updateMany no soporta "upsert",
// se usa upsert individual pero se ejecuta en un solo round-trip por batch.
async function restoreStockBatch(
  tx: Tx,
  storeId: string,
  items: { productId: string; quantity: Prisma.Decimal }[]
): Promise<void> {
  const productIds = items.map((i) => i.productId);
  const existing = await tx.inventory.findMany({
    where: { storeId, productId: { in: productIds } },
    select: { productId: true },
  });
  const existingSet = new Set(existing.map((r) => r.productId));

  const toCreate = items.filter((i) => !existingSet.has(i.productId));
  const toIncrement = items.filter((i) => existingSet.has(i.productId));

  if (toCreate.length > 0) {
    await tx.inventory.createMany({
      data: toCreate.map((i) => ({ storeId, productId: i.productId, quantity: i.quantity })),
    });
  }
  if (toIncrement.length > 0) {
    // Ejecuta increments individuales; son UPDATE simples sin condición
    // optimista, así que un solo query por item es aceptable.
    for (const i of toIncrement) {
      await tx.inventory.updateMany({
        where: { storeId, productId: i.productId },
        data: { quantity: { increment: i.quantity } },
      });
    }
  }
}

export async function createSale(input: CreateSaleInput): Promise<SaleResult> {
  return prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store) throw ApiError.notFound('Tienda no encontrada', 'STORE_NOT_FOUND');

    // Si la tienda usa control de cajas, la venta debe estar ligada a una
    // sesión abierta; de lo contrario quedaría fuera del corte de caja. Si el
    // cliente no envía el id de sesión, la resolvemos desde la sesión abierta
    // del usuario (su caja asignada o la que operó).
    if (store.controlCajas) {
      if (input.cajaSessionId) {
        const session = await tx.cajaSession.findFirst({
          where: { id: input.cajaSessionId, storeId: input.storeId, status: 'OPEN' },
        });
        if (!session) {
          throw ApiError.badRequest(
            'La sesión de caja no es válida o no está abierta',
            'CAJA_SESSION_INVALID'
          );
        }
      } else {
        const active = await tx.cajaSession.findFirst({
          where: {
            storeId: input.storeId,
            status: 'OPEN',
            OR: [
              { userId: input.userId },
              { caja: { assignedUserId: input.userId } },
            ],
          },
          orderBy: { openedAt: 'desc' },
        });
        if (!active) {
          throw ApiError.badRequest(
            'Debe abrir la caja antes de registrar ventas',
            'CAJA_SESSION_REQUIRED'
          );
        }
        input.cajaSessionId = active.id;
      }
    }

    if (input.discount < 0 || input.discount > 100) {
      throw ApiError.badRequest('El descuento debe estar entre 0 y 100%', 'INVALID_DISCOUNT');
    }

    // Validate stock and load product cost + price for all items
    let subtotal = new Prisma.Decimal(0);
    const preparedItems: Array<{
      productId: string;
      quantity: number;
      unidad: string;
      unitPrice: number;
      originalUnitPrice: number;
      costPrice: Prisma.Decimal;
      unitProfit: Prisma.Decimal;
    }> = [];

    const productIds = input.items.map((i) => i.productId);

    const products = await tx.product.findMany({
      where: { id: { in: productIds }, storeId: input.storeId, isActive: true },
    });
    if (products.length !== productIds.length) {
      throw ApiError.badRequest('Uno o más productos no existen en esta tienda', 'PRODUCT_NOT_FOUND');
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of input.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw ApiError.badRequest('Producto no encontrado', 'PRODUCT_NOT_FOUND');
      }

      // Los productos por unidad solo admiten cantidades enteras; el granel
      // (peso/volumen) admite hasta 3 decimales (gramos/ml).
      if (
        product.unidadVenta === 'UNIDAD' &&
        !Number.isInteger(item.quantity)
      ) {
        throw ApiError.badRequest(
          `"${product.name}" se vende por unidad: la cantidad debe ser un número entero`,
          'INVALID_QUANTITY'
        );
      }

      if (item.unitPrice <= 0) {
        throw ApiError.badRequest('El precio unitario debe ser positivo', 'INVALID_PRICE');
      }
    }

    // Validación de stock en lote (1 query en vez de N)
    await validateStockBatch(
      tx,
      input.storeId,
      input.items.map((it) => ({
        productId: it.productId,
        quantity: new Prisma.Decimal(it.quantity),
        name: productMap.get(it.productId)?.name,
      }))
    );

    for (const item of input.items) {
      const product = productMap.get(item.productId)!;
      const costPrice = product.costPrice;
      const unitProfit = new Prisma.Decimal(item.unitPrice).minus(costPrice);

      subtotal = subtotal.plus(new Prisma.Decimal(item.unitPrice).mul(item.quantity));
      preparedItems.push({
        productId: product.id,
        quantity: item.quantity,
        unidad: etiquetaUnidad(product.unidadVenta),
        unitPrice: item.unitPrice,
        originalUnitPrice: item.unitPrice,
        costPrice,
        unitProfit,
      });
    }

    // Resolver promociones aplicables a nivel de línea.
    const promoResolution = await resolvePromotionsForSale(
      tx,
      input.storeId,
      preparedItems.map((it) => ({
        productId: it.productId,
        unitPrice: it.unitPrice,
        quantity: it.quantity,
        categoryId: productMap.get(it.productId)?.categoryId ?? null,
        costPrice: Number(it.costPrice),
      }))
    );

    // Sobreescribe unitPrice con el precio post-promo y guarda el original.
    if (promoResolution.applied.length > 0) {
      for (let i = 0; i < preparedItems.length; i++) {
        const resolved = promoResolution.lines[i];
        if (resolved.promotionIds.length === 0) continue;
        preparedItems[i].unitPrice = resolved.unitPrice;
      }
    }

    // Recalcula subtotal con precios post-promo por línea.
    let subtotalAfterPromos = new Prisma.Decimal(0);
    for (const it of preparedItems) {
      subtotalAfterPromos = subtotalAfterPromos.plus(
        new Prisma.Decimal(it.unitPrice).mul(it.quantity)
      );
    }

    // El descuento de venta es un monto fijo en COP (no porcentaje) aplicado
    // sobre el subtotal con promos de línea. Se limita al subtotal para no
    // generar totales negativos.
    const discountDecimal = new Prisma.Decimal(
      Math.min(input.discount, subtotalAfterPromos.toNumber())
    );
    const discountAmount = discountDecimal;
    const total = subtotalAfterPromos.minus(discountAmount);

    // Para reportes: subtotal = precios normales, discountAmount incluye el
    // descuento global; el "ahorro" por promos se guarda en
    // PromotionApplication. Aquí guardamos subtotal normal para que el
    // reporte de ventas (CorteCaja) siga funcionando con la diferencia.
    const savedByPromos = subtotal.minus(subtotalAfterPromos);
    const saleSubtotal = subtotal; // precios normales
    const saleDiscount = discountAmount.plus(savedByPromos);

    let totalProfit = new Prisma.Decimal(0);
    if (subtotalAfterPromos.gt(0) && discountAmount.gt(0)) {
      // Prorratea el descuento global entre las líneas según su peso en el
      // subtotal post-promo. Esto preserva proporciones de margen por línea.
      for (const it of preparedItems) {
        const itemSubtotal = new Prisma.Decimal(it.unitPrice).mul(it.quantity);
        const proportion = itemSubtotal.div(subtotalAfterPromos);
        const itemDiscount = discountAmount.mul(proportion);
        const itemNet = itemSubtotal.minus(itemDiscount);
        const itemProfit = itemNet.minus(it.costPrice.mul(it.quantity));
        totalProfit = totalProfit.plus(itemProfit);
      }
    } else {
      for (const it of preparedItems) {
        const itemProfit = new Prisma.Decimal(it.unitPrice)
          .minus(it.costPrice)
          .mul(it.quantity);
        totalProfit = totalProfit.plus(itemProfit);
      }
    }

    const saleNumber = await generateSaleNumber(tx, input.storeId, store.code);

    const isPending = input.status === 'PENDING';

    const sale = await tx.sale.create({
      data: {
        saleNumber,
        storeId: input.storeId,
        userId: input.userId,
        subtotal: saleSubtotal,
        discount: saleDiscount,
        total,
        profit: totalProfit,
        profitMargin: total.gt(0) ? totalProfit.div(total).mul(100) : new Prisma.Decimal(0),
        paymentMethod: input.paymentMethod as PaymentMethod,
        status: isPending ? 'PENDING' : 'COMPLETED',
        ...(input.clienteId ? { clienteId: input.clienteId } : {}),
        ...(input.cajaSessionId ? { cajaSessionId: input.cajaSessionId } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.paymentMethod === 'CASH' && input.received != null
          ? { received: new Prisma.Decimal(input.received) }
          : {}),
        ...(input.paymentMethod === 'CASH' && input.change != null
          ? { change: new Prisma.Decimal(input.change) }
          : {}),
        items: {
          create: preparedItems.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            unidad: it.unidad,
            unitPrice: it.unitPrice,
            originalUnitPrice:
              it.unitPrice !== it.originalUnitPrice ? it.originalUnitPrice : null,
            costPrice: it.costPrice,
            profit: new Prisma.Decimal(it.unitPrice)
              .minus(it.costPrice)
              .mul(it.quantity),
          })),
        },
      },
      include: { items: true },
    });

    // Solo las ventas inmediatas (COMPLETED) descuentan inventario. Los
    // pedidos (PENDING) validan stock arriba pero no lo reservan ni descuentan.
    if (!isPending) {
      await decrementStockBatch(
        tx,
        input.storeId,
        preparedItems.map((it) => ({
          productId: it.productId,
          quantity: new Prisma.Decimal(it.quantity),
        }))
      );
    }

    // Persistir aplicaciones de promoción (incrementa usesCount atómicamente).
    if (promoResolution.applied.length > 0) {
      await applyPromotionResolutionToSaleTx(tx, sale.id, input.storeId, promoResolution);
    }

    // Audit log
    await tx.auditLog.create({
      data: {
        storeId: input.storeId,
        userId: input.userId,
        action: isPending ? 'CREATE_ORDER' : 'SALE',
        entity: 'SALE',
        entityId: sale.id,
        metadata: {
          saleNumber,
          total: total.toString(),
          items: input.items.length,
          paymentMethod: input.paymentMethod,
          status: isPending ? 'PENDING' : 'COMPLETED',
          ...(input.clienteId ? { clienteId: input.clienteId } : {}),
          ...(promoResolution.applied.length > 0
            ? { promotions: promoResolution.applied.length, savedByPromos: savedByPromos.toString() }
            : {}),
        },
      },
    });

    return {
      id: sale.id,
      saleNumber: sale.saleNumber,
      total: Number(total),
      profit: Number(totalProfit),
      profitMargin: Number(sale.profitMargin),
      status: isPending ? 'PENDING' : 'COMPLETED',
    };
  });
}

// Los Decimal de Prisma se serializan como string en JSON; el frontend espera
// números (p. ej. profitMargin.toFixed()). Convertimos al borde del servicio
// preservando las relaciones incluidas (items, product, user).
function serializeSale<
  T extends {
    total: Prisma.Decimal | number;
    subtotal: Prisma.Decimal | number;
    discount: Prisma.Decimal | number;
    profit: Prisma.Decimal | number;
    profitMargin: Prisma.Decimal | number;
    received?: Prisma.Decimal | number | null;
    change?: Prisma.Decimal | number | null;
    status: string;
    items: Array<{
      quantity: Prisma.Decimal | number;
      unitPrice: Prisma.Decimal | number;
      originalUnitPrice?: Prisma.Decimal | number | null;
      costPrice: Prisma.Decimal | number;
      profit: Prisma.Decimal | number;
    }>;
  },
>(sale: T) {
  return {
    ...sale,
    total: Number(sale.total),
    subtotal: Number(sale.subtotal),
    discount: Number(sale.discount),
    profit: Number(sale.profit),
    profitMargin: Number(sale.profitMargin),
    received: sale.received == null ? null : Number(sale.received),
    change: sale.change == null ? null : Number(sale.change),
    status: sale.status,
    items: sale.items.map((it) => ({
      ...it,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      originalUnitPrice:
        it.originalUnitPrice == null ? null : Number(it.originalUnitPrice),
      costPrice: Number(it.costPrice),
      profit: Number(it.profit),
      productName:
        (it as { product?: { name?: string }; productName?: string }).product?.name ??
        (it as { productName?: string }).productName,
      productPresentacion:
        (it as { product?: { presentacion?: string | null } }).product?.presentacion ?? null,
    })),
  };
}

export async function listSales(filters: {
  storeId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const where: Record<string, unknown> = { status: 'COMPLETED' };

  if (filters.storeId) where.storeId = filters.storeId;

  if (filters.startDate || filters.endDate) {
    const createdAt: Record<string, Date> = {};
    if (filters.startDate) createdAt.gte = mexicoStartOfDay(filters.startDate);
    if (filters.endDate) createdAt.lte = mexicoEndOfDay(filters.endDate);
    if (Object.keys(createdAt).length) where.createdAt = createdAt;
  }

  const sales = await prisma.sale.findMany({
    where,
    include: {
      items: { include: { product: true } },
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return sales.map(serializeSale);
}

export async function getSale(id: string, storeId: string) {
  const sale = await prisma.sale.findFirst({
    where: { id, storeId },
    include: {
      items: { include: { product: { include: { category: true } } } },
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return sale ? serializeSale(sale) : null;
}

export async function getSaleBySaleNumber(storeId: string, saleNumber: string) {
  const sale = await prisma.sale.findFirst({
    where: { saleNumber, storeId, status: 'COMPLETED' },
    include: { items: { include: { product: { include: { category: true } } } } },
  });

  return sale ? serializeSale(sale) : null;
}

export async function cancelSale(
  id: string,
  storeId: string,
  userId: string,
  cancellationReasonId?: string,
  comment?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id, storeId, status: 'COMPLETED' },
      include: { items: true, factura: { select: { id: true, status: true } } },
    });

    if (!sale) {
      throw ApiError.notFound('Venta no encontrada o ya cancelada', 'SALE_NOT_FOUND');
    }

    // No se puede cancelar una venta con factura emitida; primero la factura.
    if (sale.factura && sale.factura.status !== 'CANCELED') {
      throw ApiError.badRequest(
        'No se puede cancelar la venta: tiene una factura emitida. Cancele primero la factura.',
        'SALE_HAS_ACTIVE_INVOICE'
      );
    }

    // Restore inventory atomically (1-2 queries en vez de N upserts)
    await restoreStockBatch(
      tx,
      storeId,
      sale.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }))
    );

    // Revierte promociones aplicadas a la venta (decrementa usesCount).
    await revertPromotionApplicationsForSale(tx, id);

    const canceled = await tx.sale.update({
      where: { id },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
        canceledBy: userId,
        ...(cancellationReasonId && { cancellationReasonId }),
        ...(comment !== undefined && { cancellationComment: comment }),
      },
    });

    // Create Cancellation record if reason provided
    if (cancellationReasonId) {
      await tx.cancellation.create({
        data: {
          storeId,
          userId,
          entityType: 'SALE',
          entityId: id,
          entityNumber: sale.saleNumber,
          total: sale.total,
          type: 'FULL',
          cancellationReasonId,
          comment: comment ?? null,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'CANCEL_SALE',
        entity: 'SALE',
        entityId: id,
        metadata: {
          saleNumber: sale.saleNumber,
          ...(cancellationReasonId && { cancellationReasonId }),
          ...(comment && { comment }),
        },
      },
    });

    return canceled;
  });
}

// Confirma un pedido (status PENDING): reválida y descuenta inventario de
// forma atómica, y lo pasa a COMPLETED. Hasta este momento el pedido no
// afectó el inventario.
export async function confirmOrder(id: string, storeId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id, storeId, status: 'PENDING' },
      include: { items: true },
    });

    if (!sale) {
      throw ApiError.notFound('Pedido no encontrado o ya confirmado', 'ORDER_NOT_FOUND');
    }

    // Reválida stock disponible (puede haber cambiado desde la creación).
    await validateStockBatch(
      tx,
      storeId,
      sale.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }))
    );

    // Descuenta inventario de forma atómica.
    await decrementStockBatch(
      tx,
      storeId,
      sale.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }))
    );

    const confirmed = await tx.sale.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        confirmedAt: new Date(),
        confirmedBy: userId,
      },
    });

    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'CONFIRM_ORDER',
        entity: 'SALE',
        entityId: id,
        metadata: {
          saleNumber: sale.saleNumber,
          total: sale.total.toString(),
        },
      },
    });

    return confirmed;
  });
}

// Poner una venta en espera (ON_HOLD). El inventario no se descuenta.
// Se usa cuando un producto no está registrado o cuando el usuario necesita
// pausar la venta momentáneamente.
export async function holdSale(
  id: string,
  storeId: string,
  userId: string
) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id, storeId },
    });

    if (!sale) {
      throw ApiError.notFound('Pedido no encontrado', 'ORDER_NOT_FOUND');
    }

    if (sale.status === 'ON_HOLD') {
      throw ApiError.badRequest('El pedido ya está en espera', 'ORDER_ALREADY_ON_HOLD');
    }

    if (sale.status === 'COMPLETED') {
      throw ApiError.badRequest('No se puede poner en espera una venta completada', 'ORDER_COMPLETED_CANNOT_HOLD');
    }

    const held = await tx.sale.update({
      where: { id },
      data: { status: 'ON_HOLD' },
    });

    // Audit log
    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'HOLD_SALE',
        entity: 'SALE',
        entityId: sale.id,
        metadata: {
          saleNumber: sale.saleNumber,
          previousStatus: sale.status,
          newStatus: 'ON_HOLD',
        },
      },
    });

    return held;
  });
}

// Obtener todas las ventas en espera de una tienda.
export async function listHeldSales(storeId: string) {
  return prisma.sale.findMany({
    where: { storeId, status: 'ON_HOLD' },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

// Elimina (cancela) una venta en espera individual. Las ventas en espera no
// descuentan inventario, así que solo se marca CANCELED para conservar el rastro.
export async function deleteHeldSale(id: string, storeId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id, storeId, status: 'ON_HOLD' },
    });

    if (!sale) {
      throw ApiError.notFound(
        'Pedido en espera no encontrado',
        'HELD_SALE_NOT_FOUND'
      );
    }

    const deleted = await tx.sale.update({
      where: { id },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
        canceledBy: userId,
      },
    });

    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'DELETE_HELD_SALE',
        entity: 'SALE',
        entityId: id,
        metadata: {
          saleNumber: sale.saleNumber,
          previousStatus: 'ON_HOLD',
          newStatus: 'CANCELED',
        },
      },
    });

    return deleted;
  });
}

// Vacía todas las ventas en espera de una tienda. Marca cada una como CANCELED
// y devuelve el número de registros eliminados.
export async function clearHeldSales(storeId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const held = await tx.sale.findMany({
      where: { storeId, status: 'ON_HOLD' },
      select: { id: true, saleNumber: true },
    });

    if (held.length === 0) {
      throw ApiError.notFound(
        'No hay pedidos en espera en esta tienda',
        'NO_HELD_SALES'
      );
    }

    const updated = await tx.sale.updateMany({
      where: { storeId, status: 'ON_HOLD' },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
        canceledBy: userId,
      },
    });

    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'CLEAR_HELD_SALES',
        entity: 'SALE',
        entityId: storeId,
        metadata: {
          count: updated.count,
          saleNumbers: held.map((s) => s.saleNumber),
        },
      },
    });

    return { count: updated.count };
  });
}

// Obtener los datos de una venta en espera para cargarla en el carrito.
export async function retrieveHeldSale(id: string, storeId: string) {
  const sale = await prisma.sale.findFirst({
    where: { id, storeId, status: 'ON_HOLD' },
    include: {
      items: {
        include: {
          product: {
            include: { category: true },
          },
        },
      },
      user: { select: { id: true, name: true, email: true } },
      cliente: { select: { id: true, nombreRazonSocial: true, rfc: true } },
    },
  });

  if (!sale) {
    throw ApiError.notFound('Pedido en espera no encontrado', 'HELD_SALE_NOT_FOUND');
  }

  return sale;
}

// Confirmar/completar una venta en espera.
// Marca la venta como COMPLETED, valida y descuenta inventario atomically.
export async function completeHeldSale(
  id: string,
  storeId: string,
  userId: string,
  paymentMethod?: string
) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id, storeId, status: 'ON_HOLD' },
      include: { items: true },
    });

    if (!sale) {
      throw ApiError.notFound('Pedido en espera no encontrado o ya completado', 'HELD_SALE_NOT_FOUND');
    }

    // Validar stock disponible para cada artículo (1 query en vez de N)
    await validateStockBatch(
      tx,
      storeId,
      sale.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }))
    );

    // Descuenta inventario atomically
    await decrementStockBatch(
      tx,
      storeId,
      sale.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }))
    );

    // Actualizar venta a COMPLETED
    const confirmed = await tx.sale.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        confirmedAt: new Date(),
        confirmedBy: userId,
        ...(paymentMethod && { paymentMethod: paymentMethod as PaymentMethod }),
      },
    });

    // Audit log
    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'COMPLETE_HELD_SALE',
        entity: 'SALE',
        entityId: sale.id,
        metadata: {
          saleNumber: sale.saleNumber,
          total: sale.total.toString(),
        },
      },
    });

    return confirmed;
  });
}

// Cancela un pedido pendiente (status PENDING). Como nunca descontó
// inventario, no es necesario reponerlo; solo se marca como CANCELED.
export async function cancelOrder(id: string, storeId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id, storeId, status: 'PENDING' },
    });

    if (!sale) {
      throw ApiError.notFound('Pedido no encontrado o ya confirmado', 'ORDER_NOT_FOUND');
    }

    const canceled = await tx.sale.update({
      where: { id },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
        canceledBy: userId,
      },
    });

    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'CANCEL_ORDER',
        entity: 'SALE',
        entityId: id,
        metadata: {
          saleNumber: sale.saleNumber,
        },
      },
    });

    return canceled;
  });
}

// Lista pedidos de la tienda. status: PENDING (defecto), COMPLETED, CANCELED
// o ALL. Incluye el cliente asociado cuando existe. Opcionalmente filtra por
// rango de fechas de creación (createdAt).
export async function listOrders(filters: {
  storeId: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELED' | 'ALL';
  startDate?: string;
  endDate?: string;
}) {
  const where: Record<string, unknown> = { storeId: filters.storeId };
  if (filters.status !== 'ALL') where.status = filters.status;

  if (filters.startDate || filters.endDate) {
    const createdAt: Record<string, Date> = {};
    if (filters.startDate) createdAt.gte = mexicoStartOfDay(filters.startDate);
    if (filters.endDate) createdAt.lte = mexicoEndOfDay(filters.endDate);
    if (Object.keys(createdAt).length) where.createdAt = createdAt;
  }

  const sales = await prisma.sale.findMany({
    where,
    include: {
      items: { include: { product: true } },
      user: { select: { id: true, name: true, email: true } },
      cliente: { select: { id: true, nombreRazonSocial: true, rfc: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return sales.map(serializeSale);
}