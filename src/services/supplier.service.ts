import { prisma } from '../config/prisma';
import { Prisma, PaymentMethod } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { SupplierTxItemInput } from '../types';

export interface CreateSupplierInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  storeId: string;
}

export async function listSuppliers(storeId?: string) {
  return prisma.supplier.findMany({
    where: storeId ? { storeId } : undefined,
    orderBy: { name: 'asc' },
  });
}

export async function createSupplier(data: CreateSupplierInput, userId: string) {
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: {
        name: data.name,
        phone: data.phone ?? undefined,
        email: data.email ?? undefined,
        address: data.address ?? undefined,
        storeId: data.storeId,
      },
    });

    await tx.auditLog.create({
      data: {
        storeId: data.storeId,
        userId,
        action: 'CREATE',
        entity: 'SUPPLIER',
        entityId: supplier.id,
        metadata: { name: supplier.name },
      },
    });

    return supplier;
  });
}

export async function updateSupplier(
  id: string,
  data: Partial<CreateSupplierInput>,
  userId: string
) {
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone ?? null }),
        ...(data.email !== undefined && { email: data.email ?? null }),
        ...(data.address !== undefined && { address: data.address ?? null }),
      },
    });

    await tx.auditLog.create({
      data: {
        storeId: supplier.storeId,
        userId,
        action: 'UPDATE',
        entity: 'SUPPLIER',
        entityId: supplier.id,
        metadata: { changes: data },
      },
    });

    return supplier;
  });
}

export async function getSupplierTransactions(supplierId: string, storeId: string) {
  const transactions = await prisma.supplierTransaction.findMany({
    where: { supplierId, storeId },
    include: {
      items: { include: { product: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Los Decimal de Prisma se serializan como string en JSON; el frontend
  // espera números (p. ej. reduce() para contar artículos).
  return transactions.map((tx) => ({
    ...tx,
    total: Number(tx.total),
    items: tx.items.map((it) => ({
      ...it,
      quantity: Number(it.quantity),
      unitCost: Number(it.unitCost),
    })),
  }));
}

export interface CreateSupplierTxInput {
  supplierId: string;
  storeId: string;
  userId: string;
  items: SupplierTxItemInput[];
  paymentMethod: string;
}

export async function createSupplierTransaction(input: CreateSupplierTxInput) {
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, storeId: input.storeId },
    });
    if (!supplier) {
      throw ApiError.notFound('Proveedor no encontrado en esta tienda', 'SUPPLIER_NOT_FOUND');
    }

    let total = new Prisma.Decimal(0);
    const preparedItems: Array<{
      productId: string;
      quantity: number;
      unitCost: Prisma.Decimal;
    }> = [];

    const productIds = input.items.map((i) => i.productId);
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, storeId: input.storeId },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of input.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw ApiError.badRequest('Producto no encontrado en esta tienda', 'PRODUCT_NOT_FOUND');
      }
      if (item.unitCost <= 0 || item.quantity <= 0) {
        throw ApiError.badRequest('Costo unitario y cantidad deben ser positivos', 'INVALID_INPUT');
      }

      total = total.plus(new Prisma.Decimal(item.unitCost).mul(item.quantity));
      preparedItems.push({
        productId: product.id,
        quantity: item.quantity,
        unitCost: new Prisma.Decimal(item.unitCost),
      });
    }

    const transaction = await tx.supplierTransaction.create({
      data: {
        supplierId: input.supplierId,
        storeId: input.storeId,
        userId: input.userId,
        total,
        paymentMethod: input.paymentMethod as PaymentMethod,
        items: {
          create: preparedItems.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            unitCost: it.unitCost,
          })),
        },
      },
      include: { items: true },
    });

    // Update product cost + inventory atomically
    for (const it of preparedItems) {
      await tx.product.update({
        where: { id: it.productId },
        data: { costPrice: it.unitCost },
      });

      await tx.inventory.upsert({
        where: { storeId_productId: { storeId: input.storeId, productId: it.productId } },
        create: {
          storeId: input.storeId,
          productId: it.productId,
          quantity: it.quantity,
        },
        update: { quantity: { increment: it.quantity } },
      });
    }

    await tx.auditLog.create({
      data: {
        storeId: input.storeId,
        userId: input.userId,
        action: 'SUPPLIER_TRANSACTION',
        entity: 'SUPPLIER_TRANSACTION',
        entityId: transaction.id,
        metadata: {
          supplierId: input.supplierId,
          total: total.toString(),
          items: input.items.length,
          paymentMethod: input.paymentMethod,
        },
      },
    });

    return transaction;
  });
}

export async function cancelSupplierTransaction(
  id: string,
  storeId: string,
  userId: string,
  cancellationReasonId?: string,
  comment?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const txRecord = await tx.supplierTransaction.findFirst({
      where: { id, storeId, status: 'COMPLETED' },
      include: { items: true },
    });
    if (!txRecord) {
      throw ApiError.notFound(
        'Compra a proveedor no encontrada o ya cancelada',
        'SUPPLIER_TX_NOT_FOUND'
      );
    }

    // Restore inventory (subtract what was added)
    for (const item of txRecord.items) {
      const inventory = await tx.inventory.findUnique({
        where: { storeId_productId: { storeId, productId: item.productId } },
      });
      if (inventory) {
        const newQty = inventory.quantity.minus(item.quantity);
        if (newQty.lessThan(0)) {
          throw ApiError.badRequest(
            'No se puede cancelar: el producto tendría stock negativo',
            'INSUFFICIENT_STOCK_TO_CANCEL'
          );
        }
        await tx.inventory.update({
          where: { storeId_productId: { storeId, productId: item.productId } },
          data: { quantity: { decrement: item.quantity } },
        });
      }
    }

    const canceled = await tx.supplierTransaction.update({
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
          entityType: 'SUPPLIER_TRANSACTION',
          entityId: id,
          entityNumber: id,
          total: txRecord.total,
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
        action: 'CANCEL_SUPPLIER_TX',
        entity: 'SUPPLIER_TRANSACTION',
        entityId: id,
        metadata: {
          total: txRecord.total.toString(),
          ...(cancellationReasonId && { cancellationReasonId }),
          ...(comment && { comment }),
        },
      },
    });

    return canceled;
  });
}