import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';

export interface CreateCategoryInput {
  name: string;
  storeId: string;
}

function mapearErrorNombreDuplicado(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  ) {
    return ApiError.conflict(
      'Ya existe una categoría con ese nombre en esta tienda',
      'CATEGORIA_DUPLICADA'
    );
  }
  return error;
}

export async function listCategories(storeId?: string) {
  return prisma.category.findMany({
    where: storeId ? { storeId } : undefined,
    include: { _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function createCategory(data: CreateCategoryInput, userId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const category = await tx.category.create({
        data: {
          name: data.name,
          storeId: data.storeId,
        },
      });

      await tx.auditLog.create({
        data: {
          storeId: data.storeId,
          userId,
          action: 'CREATE',
          entity: 'CATEGORY',
          entityId: category.id,
          metadata: { name: category.name },
        },
      });

      return category;
    });
  } catch (error) {
    throw mapearErrorNombreDuplicado(error);
  }
}

export async function updateCategory(
  id: string,
  data: Partial<CreateCategoryInput>,
  userId: string
) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Categoría no encontrada', 'CATEGORIA_NOT_FOUND');

  try {
    return await prisma.$transaction(async (tx) => {
      const category = await tx.category.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.storeId !== undefined && { storeId: data.storeId }),
        },
      });

      await tx.auditLog.create({
        data: {
          storeId: category.storeId,
          userId,
          action: 'UPDATE',
          entity: 'CATEGORY',
          entityId: category.id,
          metadata: { changes: data },
        },
      });

      return category;
    });
  } catch (error) {
    throw mapearErrorNombreDuplicado(error);
  }
}

export async function deleteCategory(id: string, userId: string) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Categoría no encontrada', 'CATEGORIA_NOT_FOUND');

  const productosRelacionados = await prisma.product.count({ where: { categoryId: id } });
  if (productosRelacionados > 0) {
    throw ApiError.conflict(
      `No se puede eliminar la categoría porque tiene ${productosRelacionados} producto(s) asociado(s)`,
      'CATEGORIA_CON_PRODUCTOS'
    );
  }

  return prisma.$transaction(async (tx) => {
    const deleted = await tx.category.delete({ where: { id } });

    await tx.auditLog.create({
      data: {
        storeId: deleted.storeId,
        userId,
        action: 'DELETE',
        entity: 'CATEGORY',
        entityId: deleted.id,
        metadata: { name: deleted.name },
      },
    });

    return deleted;
  });
}
