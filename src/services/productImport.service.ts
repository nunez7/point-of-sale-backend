import * as XLSX from 'xlsx';
import { Prisma, UnidadVenta } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';
import { generarSkuAutomatico } from './product.service';

const PRODUCT_TEMPLATE_COLUMNS = [
  { key: 'name' },
  { key: 'sku' },
  { key: 'description' },
  { key: 'presentacion' },
  { key: 'unidadVenta' },
  { key: 'categoryId' },
  { key: 'categoryName' },
  { key: 'costPrice' },
  { key: 'sellingPrice' },
  { key: 'sortOrder' },
  { key: 'lowStockThreshold' },
  { key: 'isActive' },
  { key: 'initialStock' },
];

export interface ProductImportRow {
  name: string;
  sku: string;
  description?: string | null;
  presentacion?: string | null;
  unidadVenta?: UnidadVenta;
  categoryId?: string | null;
  categoryName?: string | null;
  costPrice: number;
  sellingPrice: number;
  sortOrder?: number;
  lowStockThreshold?: number;
  isActive?: boolean;
  initialStock?: number;
}

export interface ProductImportError {
  row: number;
  field: string;
  message: string;
  value?: unknown;
}

export interface ProductImportResult {
  created: number;
  updated: number;
  errors: ProductImportError[];
  skipped: number;
  total: number;
}

const REQUIRED_FIELDS = ['name', 'sku', 'costPrice', 'sellingPrice'] as const;

function parseUnidadVenta(value: unknown): UnidadVenta | null {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim().toUpperCase();
  if (['UNIDAD', 'PESO', 'VOLUMEN'].includes(str)) {
    return str as UnidadVenta;
  }
  return null;
}

function parseBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const str = String(value).trim().toLowerCase();
  if (['true', '1', 'si', 'sí', 'yes', 'verdadero'].includes(str)) return true;
  if (['false', '0', 'no', 'false', 'falso'].includes(str)) return false;
  return null;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

function parseIntSafe(value: unknown): number | null {
  const num = parseNumber(value);
  return num !== null && Number.isInteger(num) ? num : null;
}

function validateRow(row: Record<string, unknown>, rowNum: number): ProductImportError[] {
  const errors: ProductImportError[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = row[field];
    if (value === null || value === undefined || String(value).trim() === '') {
      errors.push({
        row: rowNum,
        field,
        message: `Campo requerido '${field}' está vacío`,
        value,
      });
    }
  }

  const costPrice = parseNumber(row.costPrice);
  const sellingPrice = parseNumber(row.sellingPrice);

  if (costPrice !== null && costPrice <= 0) {
    errors.push({ row: rowNum, field: 'costPrice', message: 'El costo debe ser mayor a 0', value: row.costPrice });
  }
  if (sellingPrice !== null && sellingPrice <= 0) {
    errors.push({ row: rowNum, field: 'sellingPrice', message: 'El precio de venta debe ser mayor a 0', value: row.sellingPrice });
  }
  if (costPrice !== null && sellingPrice !== null && sellingPrice <= costPrice) {
    errors.push({
      row: rowNum,
      field: 'sellingPrice',
      message: 'El precio de venta debe ser mayor al costo',
      value: row.sellingPrice,
    });
  }

  const unidadVenta = parseUnidadVenta(row.unidadVenta);
  if (row.unidadVenta !== null && row.unidadVenta !== undefined && row.unidadVenta !== '' && unidadVenta === null) {
    errors.push({
      row: rowNum,
      field: 'unidadVenta',
      message: 'unidadVenta debe ser: UNIDAD, PESO o VOLUMEN',
      value: row.unidadVenta,
    });
  }

  const sortOrder = parseIntSafe(row.sortOrder);
  if (row.sortOrder !== null && row.sortOrder !== undefined && row.sortOrder !== '' && (sortOrder === null || sortOrder < 0)) {
    errors.push({ row: rowNum, field: 'sortOrder', message: 'sortOrder debe ser un entero >= 0', value: row.sortOrder });
  }

  const lowStockThreshold = parseIntSafe(row.lowStockThreshold);
  if (row.lowStockThreshold !== null && row.lowStockThreshold !== undefined && row.lowStockThreshold !== '' && (lowStockThreshold === null || lowStockThreshold < 0)) {
    errors.push({ row: rowNum, field: 'lowStockThreshold', message: 'lowStockThreshold debe ser un entero >= 0', value: row.lowStockThreshold });
  }

  const initialStock = parseNumber(row.initialStock);
  if (row.initialStock !== null && row.initialStock !== undefined && row.initialStock !== '' && (initialStock === null || initialStock < 0)) {
    errors.push({ row: rowNum, field: 'initialStock', message: 'initialStock debe ser un número >= 0', value: row.initialStock });
  }

  const isActive = parseBoolean(row.isActive);
  if (row.isActive !== null && row.isActive !== undefined && row.isActive !== '' && isActive === null) {
    errors.push({ row: rowNum, field: 'isActive', message: 'isActive debe ser true/false', value: row.isActive });
  }

  return errors;
}

function rowToProductInput(row: Record<string, unknown>, _rowNum: number): ProductImportRow {
  return {
    name: String(row.name ?? '').trim(),
    sku: String(row.sku ?? '').trim(),
    description: row.description ? String(row.description).trim() : null,
    presentacion: row.presentacion ? String(row.presentacion).trim() : null,
    unidadVenta: parseUnidadVenta(row.unidadVenta) ?? 'UNIDAD',
    categoryId: row.categoryId ? String(row.categoryId).trim() : null,
    categoryName: row.categoryName ? String(row.categoryName).trim() : null,
    costPrice: parseNumber(row.costPrice) ?? 0,
    sellingPrice: parseNumber(row.sellingPrice) ?? 0,
    sortOrder: parseIntSafe(row.sortOrder) ?? 0,
    lowStockThreshold: parseIntSafe(row.lowStockThreshold) ?? 5,
    isActive: parseBoolean(row.isActive) ?? true,
    initialStock: parseNumber(row.initialStock) ?? 0,
  };
}

async function findOrCreateCategory(
  tx: Prisma.TransactionClient,
  storeId: string,
  categoryId: string | null | undefined,
  categoryName: string | null | undefined
): Promise<string | null> {
  if (categoryId) {
    const cat = await tx.category.findUnique({ where: { id: categoryId } });
    if (!cat || cat.storeId !== storeId) {
      throw ApiError.notFound(`Categoría con ID ${categoryId} no encontrada en esta tienda`, 'CATEGORY_NOT_FOUND');
    }
    return categoryId;
  }
  if (categoryName) {
    let cat = await tx.category.findFirst({
      where: { storeId, name: categoryName },
    });
    if (!cat) {
      cat = await tx.category.create({
        data: { name: categoryName, storeId },
      });
    }
    return cat.id;
  }
  return null;
}

export async function importProductsFromExcel(
  fileBuffer: Buffer,
  storeId: string,
  userId: string
): Promise<ProductImportResult> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  } catch {
    throw ApiError.badRequest('No se pudo leer el archivo Excel. Verifique que sea un archivo .xlsx o .xls válido.', 'INVALID_EXCEL_FILE');
  }

  const sheetName = workbook.SheetNames.find((name) => name === 'Productos') ?? workbook.SheetNames[0];
  if (!sheetName) {
    throw ApiError.badRequest('El archivo Excel no contiene hojas.', 'EMPTY_EXCEL_FILE');
  }

  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as (string | number)[][];

  if (jsonData.length < 2) {
    throw ApiError.badRequest('El archivo Excel debe contener al menos una fila de encabezados y una fila de datos.', 'NO_DATA_ROWS');
  }

  const headers = jsonData[0].map((h) => String(h).trim().toLowerCase());
  const expectedHeaders = PRODUCT_TEMPLATE_COLUMNS.map((c) => c.key.toLowerCase());

  const missingHeaders = expectedHeaders.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    throw ApiError.badRequest(
      `Faltan columnas requeridas en el archivo: ${missingHeaders.join(', ')}. Descargue la plantilla correcta.`,
      'MISSING_COLUMNS'
    );
  }

  const headerIndexMap = new Map<string, number>();
  const keyMap = new Map<string, string>(); // lowercase -> original key
  expectedHeaders.forEach((h) => {
    const foundIdx = headers.indexOf(h);
    if (foundIdx >= 0) {
      headerIndexMap.set(h, foundIdx);
      // Find original key from PRODUCT_TEMPLATE_COLUMNS
      const originalKey = PRODUCT_TEMPLATE_COLUMNS.find((c) => c.key.toLowerCase() === h)?.key ?? h;
      keyMap.set(h, originalKey);
    }
  });

  const result: ProductImportResult = {
    created: 0,
    updated: 0,
    errors: [],
    skipped: 0,
    total: 0,
  };

  for (let i = 1; i < jsonData.length; i++) {
    const rowArray = jsonData[i];
    result.total++;

    const row: Record<string, unknown> = {};
    for (const [lowerKey, idx] of headerIndexMap.entries()) {
      const originalKey = keyMap.get(lowerKey) ?? lowerKey;
      row[originalKey] = rowArray[idx];
    }

    if (Object.values(row).every((v) => v === null || v === undefined || String(v).trim() === '')) {
      result.skipped++;
      continue;
    }

    const nameValue = row.name ? String(row.name).trim() : '';
    if (nameValue === 'EJEMPLO - NO IMPORTAR' || nameValue.startsWith('EJEMPLO')) {
      result.skipped++;
      continue;
    }

    const validationErrors = validateRow(row, i + 1);
    if (validationErrors.length > 0) {
      result.errors.push(...validationErrors);
      continue;
    }

    const input = rowToProductInput(row, i + 1);

    try {
      await prisma.$transaction(async (tx) => {
        const categoryId = await findOrCreateCategory(tx, storeId, input.categoryId, input.categoryName);

        const existingProduct = await tx.product.findUnique({
          where: { sku: input.sku },
        });

        if (existingProduct) {
          if (existingProduct.storeId !== storeId) {
            throw ApiError.conflict(
              `El SKU "${input.sku}" ya existe en otra tienda`,
              'SKU_EXISTS_OTHER_STORE'
            );
          }

          await tx.product.update({
            where: { id: existingProduct.id },
            data: {
              name: input.name,
              description: input.description,
              presentacion: input.presentacion,
              unidadVenta: input.unidadVenta,
              categoryId,
              costPrice: input.costPrice,
              sellingPrice: input.sellingPrice,
              sortOrder: input.sortOrder,
              isActive: input.isActive,
            },
          });

          await tx.inventory.upsert({
            where: { storeId_productId: { storeId, productId: existingProduct.id } },
            create: { storeId, productId: existingProduct.id, quantity: input.initialStock, lowStockThreshold: input.lowStockThreshold },
            update: { quantity: input.initialStock, lowStockThreshold: input.lowStockThreshold },
          });

          await tx.auditLog.create({
            data: {
              storeId,
              userId,
              action: 'UPDATE',
              entity: 'PRODUCT',
              entityId: existingProduct.id,
              metadata: {
                name: input.name,
                sku: input.sku,
                costPrice: input.costPrice,
                sellingPrice: input.sellingPrice,
                importSource: 'EXCEL',
              },
            },
          });

          result.updated++;
        } else {
          const sku = input.sku || (await generarSkuAutomatico(tx));

          const product = await tx.product.create({
            data: {
              name: input.name,
              sku,
              description: input.description,
              presentacion: input.presentacion,
              unidadVenta: input.unidadVenta,
              categoryId,
              storeId,
              costPrice: input.costPrice,
              sellingPrice: input.sellingPrice,
              sortOrder: input.sortOrder,
              isActive: input.isActive,
            },
          });

          await tx.inventory.upsert({
            where: { storeId_productId: { storeId, productId: product.id } },
            create: { storeId, productId: product.id, quantity: input.initialStock, lowStockThreshold: input.lowStockThreshold },
            update: { quantity: input.initialStock, lowStockThreshold: input.lowStockThreshold },
          });

          await tx.auditLog.create({
            data: {
              storeId,
              userId,
              action: 'CREATE',
              entity: 'PRODUCT',
              entityId: product.id,
              metadata: {
                name: product.name,
                sku: product.sku,
                costPrice: input.costPrice,
                sellingPrice: input.sellingPrice,
                importSource: 'EXCEL',
              },
            },
          });

          result.created++;
        }
      });
    } catch (error) {
      if (error instanceof ApiError) {
        result.errors.push({ row: i + 1, field: 'general', message: error.message, value: input.sku });
      } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        result.errors.push({ row: i + 1, field: 'sku', message: 'El SKU ya está registrado', value: input.sku });
      } else {
        result.errors.push({ row: i + 1, field: 'general', message: 'Error inesperado al procesar la fila', value: input.sku });
      }
    }
  }

  return result;
}