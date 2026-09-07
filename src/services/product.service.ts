import { Prisma, UnidadVenta } from '../../generated/prisma/client.js';
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

export async function generarSkuAutomatico(tx: Prisma.TransactionClient): Promise<string> {
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

export type ProductSortBy =
  | 'name'
  | 'category'
  | 'sku'
  | 'costPrice'
  | 'sellingPrice';

export interface ProductFilters {
  storeId?: string;
  search?: string;
  category?: string;
  includeInactive?: boolean;
  page?: number;
  limit?: number;
  sortBy?: ProductSortBy;
  sortOrder?: 'asc' | 'desc';
}

export async function listProducts(filters: ProductFilters) {
  const where: Record<string, unknown> = {};

  // Por defecto solo activos (catálogo de venta); el módulo de administración
  // puede pedir también los inactivos para reactivarlos.
  if (!filters.includeInactive) where.isActive = true;

  if (filters.storeId) where.storeId = filters.storeId;
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { sku: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }
  if (filters.category) {
    where.category = { id: filters.category };
  }

  const dir = filters.sortOrder ?? 'asc';
  // Al ordenar por categoría se desempata por nombre para un listado estable.
  // Sin sortBy (POS), se usa sortOrder como criterio principal.
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    !filters.sortBy
      ? [{ sortOrder: 'asc' }, { name: 'asc' }]
      : filters.sortBy === 'category'
        ? [{ category: { name: dir } }, { sortOrder: 'asc' }, { name: 'asc' }]
        : filters.sortBy === 'sku'
          ? [{ sku: dir }]
          : filters.sortBy === 'costPrice'
            ? [{ costPrice: dir }]
            : filters.sortBy === 'sellingPrice'
              ? [{ sellingPrice: dir }]
              : [{ sortOrder: 'asc' }, { name: dir }];

  const baseArgs = {
    where,
    include: {
      category: true,
      inventories: { select: { storeId: true, quantity: true } },
    },
    orderBy,
  };

  // Sin `page` se devuelve el listado completo (POS, selects de compra).
  if (!filters.page) {
    return { products: await prisma.product.findMany(baseArgs) };
  }

  const limit = filters.limit ?? 50;
  const [products, total] = await prisma.$transaction([
    prisma.product.findMany({
      ...baseArgs,
      skip: (filters.page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products,
    total,
    page: filters.page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getProduct(id: string, storeId?: string) {
  return prisma.product.findFirst({
    where: { id, ...(storeId ? { storeId } : {}) },
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
  presentacion?: string | null;
  unidadVenta?: UnidadVenta;
  categoryId?: string | null;
  storeId: string;
  costPrice: number;
  sellingPrice: number;
  sortOrder?: number;
  isActive?: boolean;
  expirationDate?: string | null;
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
          presentacion: data.presentacion?.trim() ? data.presentacion.trim() : undefined,
          unidadVenta: data.unidadVenta ?? 'UNIDAD',
          categoryId: data.categoryId ?? undefined,
          storeId: data.storeId,
          costPrice: data.costPrice,
          sellingPrice: data.sellingPrice,
          sortOrder: data.sortOrder ?? 0,
          isActive: data.isActive ?? true,
          expirationDate: data.expirationDate ?? '2100-02-02T00:00:00Z',
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
        metadata: {
          name: product.name,
          costPrice: data.costPrice,
          sellingPrice: data.sellingPrice,
          presentacion: product.presentacion,
          unidadVenta: product.unidadVenta,
        },
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
          ...(data.presentacion !== undefined && {
            presentacion: data.presentacion?.trim() ? data.presentacion.trim() : null,
          }),
          ...(data.unidadVenta !== undefined && { unidadVenta: data.unidadVenta }),
          ...(data.categoryId !== undefined && { categoryId: data.categoryId ?? null }),
          ...(data.costPrice !== undefined && { costPrice: data.costPrice }),
          ...(data.sellingPrice !== undefined && { sellingPrice: data.sellingPrice }),
          ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
          ...(data.expirationDate !== undefined && { expirationDate: data.expirationDate }),
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

  // El histórico de compras/ventas impide el borrado físico: se sugiere desactivar.
  const compras = await prisma.supplierTransactionItem.count({ where: { productId: id } });
  if (compras > 0) {
    throw ApiError.conflict(
      'No se puede eliminar el producto porque tiene compras registradas. Se sugiere desactivarlo.',
      'PRODUCTO_CON_COMPRAS'
    );
  }

  const ventas = await prisma.saleItem.count({ where: { productId: id } });
  if (ventas > 0) {
    throw ApiError.conflict(
      'No se puede eliminar el producto porque tiene ventas registradas. Se sugiere desactivarlo.',
      'PRODUCTO_CON_VENTAS'
    );
  }

  return prisma.$transaction(async (tx) => {
    // El inventario se elimina en cascada junto con el producto.
    const deleted = await tx.product.delete({ where: { id } });

    await tx.auditLog.create({
      data: {
        storeId: deleted.storeId,
        userId,
        action: 'DELETE',
        entity: 'PRODUCT',
        entityId: deleted.id,
        metadata: { name: deleted.name, sku: deleted.sku },
      },
    });

    return deleted;
  });
}
