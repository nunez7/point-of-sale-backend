import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';

const SKU_AUTO_PREFIJO = 'PRODUCT-';

function formatearSku(consecutivo: number): string {
  return `${SKU_AUTO_PREFIJO}${String(consecutivo).padStart(3, '0')}`;
}

async function siguienteConsecutivo(
  cliente: Prisma.TransactionClient | typeof prisma
): Promise<number> {
  const productos = await cliente.product.findMany({
    where: { sku: { startsWith: SKU_AUTO_PREFIJO } },
    select: { sku: true },
  });
  const consecutivos = productos.flatMap((p) => {
    const match = /^PRODUCT-(\d+)$/.exec(p.sku ?? '');
    return match ? [Number(match[1])] : [];
  });
  return consecutivos.length ? Math.max(...consecutivos) + 1 : 1;
}

export async function obtenerSiguienteSku(): Promise<string> {
  return formatearSku(await siguienteConsecutivo(prisma));
}

async function generarSkuAutomatico(tx: Prisma.TransactionClient): Promise<string> {
  let consecutivo = await siguienteConsecutivo(tx);
  let sku = formatearSku(consecutivo);
  // Avanza si el código ya fue tomado (ej. códigos de barras manuales)
  while (await tx.product.findUnique({ where: { sku } })) {
    consecutivo += 1;
    sku = formatearSku(consecutivo);
  }
  return sku;
}

function mapearErrorSkuDuplicado(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return ApiError.conflict(
      'El código (SKU) ya está registrado en otro producto',
      'SKU_DUPLICADO'
    );
  }
  return error;
}

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
  const sku = data.sku?.trim() ? data.sku.trim() : undefined;
  try {
    return await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: data.name,
          // Si no se envía SKU se genera uno automático: PRODUCT-001, PRODUCT-002, ...
          sku: sku ?? (await generarSkuAutomatico(tx)),
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
  } catch (error) {
    throw mapearErrorSkuDuplicado(error);
  }
}

export async function updateProduct(
  id: string,
  data: Partial<CreateProductInput>,
  userId: string
) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Producto no encontrado', 'PRODUCT_NOT_FOUND');

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.sku !== undefined && {
            sku: data.sku?.trim() ? data.sku.trim() : null,
          }),
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
  } catch (error) {
    throw mapearErrorSkuDuplicado(error);
  }
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
