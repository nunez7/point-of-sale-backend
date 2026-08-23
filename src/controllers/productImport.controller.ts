import { Response } from 'express';
import { asyncAuthHandler } from '../utils/asyncHandler';
import { generateProductExcelTemplate, CategoryRef } from '../utils/excelTemplate';
import { importProductsFromExcel, ProductImportResult } from '../services/productImport.service';
import { AuthedRequest } from '../types';
import { ApiError } from '../utils/ApiError';
import { prisma } from '../config/prisma';

export const importProducts = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const file = req.file;
  if (!file) {
    throw ApiError.badRequest('No se proporcionó archivo. Seleccione un archivo .xlsx o .xls', 'NO_FILE_UPLOADED');
  }

  const storeId = req.user!.storeId;
  const userId = req.user!.id;

  const result: ProductImportResult = await importProductsFromExcel(file.buffer, storeId, userId);

  const statusCode = result.errors.length > 0 && result.created === 0 && result.updated === 0 ? 400 : 200;

  res.status(statusCode).json({
    created: result.created,
    updated: result.updated,
    errors: result.errors,
    skipped: result.skipped,
    total: result.total,
    message: result.errors.length > 0
      ? `Importación completada con ${result.errors.length} error(es). ${result.created} creados, ${result.updated} actualizados.`
      : `Importación exitosa: ${result.created} productos creados, ${result.updated} actualizados.`,
  });
});

export const downloadProductTemplate = asyncAuthHandler(async (req: AuthedRequest, res: Response) => {
  const storeId = req.user!.storeId;

  const categories = await prisma.category.findMany({
    where: { storeId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const categoryRefs: CategoryRef[] = categories.map((c) => ({ id: c.id, name: c.name }));

  const buffer = generateProductExcelTemplate(categoryRefs);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-productos.xlsx"');
  res.setHeader('Content-Length', buffer.length.toString());

  res.send(buffer);
});