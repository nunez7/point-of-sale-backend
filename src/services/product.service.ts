import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';

export interface ProductFilters {
  storeId?: string;
  search?: string;
  category?: string;
}

export async function listProducts(filters: ProductFilters) {
  const where: Record<string, unknown> = { isActive: true };

  if (filters.storeId) where.storeId = filters.storeId;
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { sku: { contains: filters.search, mode: 'insensitive' } },
    ];
  }
  if (filters.category) {
    where.category = { id: filters.category };
  }

  return prisma.product.findMany({
    where,
    include: {
      category: true,
      inventories: { select: { storeId: true, quantity: true } },
    },
    orderBy: { name: 'asc' },
  });
}

export async function getProduct(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      inventories: { include: { store: true } },
    },
  });
}

export interface CreateProductInput {
  name: string;
  sku?: string | null;
  description?: string | null;
  categoryId?: string | null;
  storeId: string;
  costPrice: number;
  sellingPrice: number;
}

export async function createProduct(data: CreateProductInput, userId: string) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: data.name,
        sku: data.sku ?? undefined,
        description: data.description ?? undefined,
        categoryId: data.categoryId ?? undefined,
        storeId: data.storeId,
        costPrice: data.costPrice,
        sellingPrice: data.sellingPrice,
      },
      include: { category: true },
    });

    // Initialize inventory for the store
    await tx.inventory.upsert({
      where: { storeId_productId: { storeId: data.storeId, productId: product.id } },
      create: { storeId: data.storeId, productId: product.id, quantity: 0 },
      update: {},
    });

    await tx.auditLog.create({
      data: {
        storeId: data.storeId,
        userId,
        action: 'CREATE',
        entity: 'PRODUCT',
        entityId: product.id,
        metadata: { name: product.name, costPrice: data.costPrice, sellingPrice: data.sellingPrice },
      },
    });

    return product;
  });
}

export async function updateProduct(
  id: string,
  data: Partial<CreateProductInput>,
  userId: string
) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Producto no encontrado', 'PRODUCT_NOT_FOUND');

  const updated = await prisma.$transaction(async (tx) => {
    const product = await tx.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.sku !== undefined && { sku: data.sku ?? null }),
        ...(data.description !== undefined && { description: data.description ?? null }),
        ...(data.categoryId !== undefined && { categoryId: data.categoryId ?? null }),
        ...(data.costPrice !== undefined && { costPrice: data.costPrice }),
        ...(data.sellingPrice !== undefined && { sellingPrice: data.sellingPrice }),
      },
      include: { category: true },
    });

    await tx.auditLog.create({
      data: {
        storeId: product.storeId,
        userId,
        action: 'UPDATE',
        entity: 'PRODUCT',
        entityId: product.id,
        metadata: { changes: data },
      },
    });

    return product;
  });

  return updated;
}

export async function deleteProduct(id: string, userId: string) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Producto no encontrado', 'PRODUCT_NOT_FOUND');

  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.product.update({
      where: { id },
      data: { isActive: false },
    });

    await tx.auditLog.create({
      data: {
        storeId: deleted.storeId,
        userId,
        action: 'DELETE',
        entity: 'PRODUCT',
        entityId: deleted.id,
      },
    });

    return deleted;
  });

  return result;
}
