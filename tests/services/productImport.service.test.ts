import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { prismaMock } from '../helpers/prismaMock';
import { categoryFixture, inventoryLotFixture, productFixture } from '../helpers/fixtures';
import { prismaKnownError } from '../helpers/prismaErrors';
import { expectApiError } from '../helpers/expectApiError';
import { importProductsFromExcel } from '../../src/services/productImport.service';

// SheetJS real en todo el archivo; solo se envuelve `read` para poder simular
// el único caso que no se puede construir con la librería: un libro sin hojas
// (XLSX.write se niega a serializar un workbook vacío con "Workbook is empty").
vi.mock('xlsx', async (importOriginal) => {
  const real = await importOriginal<typeof import('xlsx')>();
  return { ...real, read: vi.fn(real.read) };
});

const COLUMNAS = [
  'name',
  'sku',
  'description',
  'presentacion',
  'unidadVenta',
  'categoryId',
  'categoryName',
  'costPrice',
  'sellingPrice',
  'sortOrder',
  'lowStockThreshold',
  'isActive',
  'initialStock',
  'expirationDate',
] as const;

type Columna = (typeof COLUMNAS)[number];

const FILA_BASE: Record<Columna, string | number> = {
  name: 'Arroz Blanco 1kg',
  sku: 'ARROZ-1KG',
  description: '',
  presentacion: '',
  unidadVenta: '',
  categoryId: '',
  categoryName: '',
  costPrice: 2500,
  sellingPrice: 3500,
  sortOrder: '',
  lowStockThreshold: '',
  isActive: '',
  initialStock: '',
  expirationDate: '',
};

/** Valores de una fila indexados por columna. */
function valoresFila(
  cambios: Partial<Record<Columna, string | number>> = {}
): Record<Columna, string | number> {
  return { ...FILA_BASE, ...cambios };
}

/** Arma una fila (array) del libro respetando el orden de las 14 columnas. */
function fila(cambios: Partial<Record<Columna, string | number>> = {}): (string | number)[] {
  const valores = valoresFila(cambios);
  return COLUMNAS.map((columna) => valores[columna]);
}

/** Serializa un libro real en memoria (sin tocar el sistema de archivos). */
function libro(
  filas: (string | number)[][],
  opciones: { hoja?: string; encabezados?: string[] } = {}
): Buffer {
  const wb = XLSX.utils.book_new();
  const encabezados = opciones.encabezados ?? [...COLUMNAS];
  const ws = XLSX.utils.aoa_to_sheet([encabezados, ...filas]);
  XLSX.utils.book_append_sheet(wb, ws, opciones.hoja ?? 'Productos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Deja listo el camino de creación de producto (sin inventario previo). */
function prepararCreacion(): void {
  prismaMock.category.findFirst.mockResolvedValue(null);
  prismaMock.category.create.mockResolvedValue(categoryFixture({ id: 'cat-1', name: 'Abarrotes' }));
  prismaMock.product.findUnique.mockResolvedValue(null);
  prismaMock.product.create.mockResolvedValue(
    productFixture({ id: 'product-9', sku: 'ARROZ-1KG', name: 'Arroz Blanco 1kg' })
  );
  prismaMock.inventory.upsert.mockResolvedValue({ id: 'inventory-1' });
  prismaMock.inventoryLot.findMany.mockResolvedValue([]);
  prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-1' }));
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
}

describe('importProductsFromExcel', () => {
  it('crea el producto, su inventario, el lote y el registro de auditoría', async () => {
    prepararCreacion();

    const resultado = await importProductsFromExcel(
      libro([
        fila({
          description: 'Arroz grano largo',
          presentacion: '1 KG',
          unidadVenta: 'peso',
          categoryName: 'Abarrotes',
          sortOrder: '2',
          lowStockThreshold: '3',
          isActive: 'no',
          initialStock: '5',
          expirationDate: '2030-12-31',
        }),
      ]),
      'store-1',
      'user-1'
    );

    expect(resultado).toEqual({ created: 1, updated: 0, errors: [], skipped: 0, total: 1 });
    expect(prismaMock.category.create).toHaveBeenCalledWith({
      data: { name: 'Abarrotes', storeId: 'store-1' },
    });
    expect(prismaMock.product.create).toHaveBeenCalledWith({
      data: {
        name: 'Arroz Blanco 1kg',
        sku: 'ARROZ-1KG',
        description: 'Arroz grano largo',
        presentacion: '1 KG',
        unidadVenta: 'PESO',
        categoryId: 'cat-1',
        storeId: 'store-1',
        costPrice: 2500,
        sellingPrice: 3500,
        sortOrder: 2,
        isActive: false,
        expirationDate: '2030-12-31',
      },
    });
    expect(prismaMock.inventory.upsert).toHaveBeenCalledWith({
      where: { storeId_productId: { storeId: 'store-1', productId: 'product-9' } },
      create: { storeId: 'store-1', productId: 'product-9', quantity: 5, lowStockThreshold: 3 },
      update: { quantity: 5, lowStockThreshold: 3 },
    });

    const lote = prismaMock.inventoryLot.create.mock.calls[0]?.[0]?.data as any;
    expect(lote).toEqual(
      expect.objectContaining({
        storeId: 'store-1',
        productId: 'product-9',
        lotCode: 'AJUSTE',
        status: 'ACTIVE',
      })
    );
    expect(lote.receivedQty.toString()).toBe('5');
    expect(lote.availableQty.toString()).toBe('5');
    expect(lote.unitCost.toString()).toBe('2500');
    expect(lote.expirationDate).toEqual(new Date(Date.UTC(2030, 11, 31)));

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'CREATE',
        entity: 'PRODUCT',
        entityId: 'product-9',
        metadata: {
          name: 'Arroz Blanco 1kg',
          sku: 'ARROZ-1KG',
          costPrice: 2500,
          sellingPrice: 3500,
          importSource: 'EXCEL',
        },
      },
    });
  });

  it('aplica los valores por defecto cuando las columnas opcionales van vacías', async () => {
    prepararCreacion();

    const resultado = await importProductsFromExcel(
      libro([fila({ costPrice: '12.50', sellingPrice: '20.00' })]),
      'store-1',
      'user-1'
    );

    expect(resultado.created).toBe(1);
    expect(prismaMock.product.create.mock.calls[0]?.[0]?.data).toEqual({
      name: 'Arroz Blanco 1kg',
      sku: 'ARROZ-1KG',
      description: null,
      presentacion: null,
      unidadVenta: 'UNIDAD',
      categoryId: null,
      storeId: 'store-1',
      costPrice: 12.5,
      sellingPrice: 20,
      sortOrder: 0,
      isActive: true,
      expirationDate: '2100-02-02T00:00:00Z',
    });
    expect(prismaMock.inventory.upsert.mock.calls[0]?.[0]).toEqual({
      where: { storeId_productId: { storeId: 'store-1', productId: 'product-9' } },
      create: { storeId: 'store-1', productId: 'product-9', quantity: 0, lowStockThreshold: 5 },
      update: { quantity: 0, lowStockThreshold: 5 },
    });
    // Sin stock inicial no se crea lote de respaldo.
    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('reutiliza la categoría cuando ya existe por nombre', async () => {
    prepararCreacion();
    prismaMock.category.findFirst.mockResolvedValue(categoryFixture({ id: 'cat-existente' }));

    await importProductsFromExcel(
      libro([fila({ categoryName: 'Abarrotes' })]),
      'store-1',
      'user-1'
    );

    expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
      where: { storeId: 'store-1', name: 'Abarrotes' },
    });
    expect(prismaMock.category.create).not.toHaveBeenCalled();
    expect(prismaMock.product.create.mock.calls[0]?.[0]?.data).toEqual(
      expect.objectContaining({ categoryId: 'cat-existente' })
    );
  });

  it('usa el categoryId cuando se envía uno de la misma tienda', async () => {
    prepararCreacion();
    prismaMock.category.findUnique.mockResolvedValue(
      categoryFixture({ id: 'cat-7', storeId: 'store-1' })
    );

    await importProductsFromExcel(
      libro([fila({ categoryId: 'cat-7' })]),
      'store-1',
      'user-1'
    );

    expect(prismaMock.category.findUnique).toHaveBeenCalledWith({ where: { id: 'cat-7' } });
    expect(prismaMock.product.create.mock.calls[0]?.[0]?.data).toEqual(
      expect.objectContaining({ categoryId: 'cat-7' })
    );
  });

  it('reporta la fila cuando el categoryId no existe en la tienda', async () => {
    prepararCreacion();
    prismaMock.category.findUnique.mockResolvedValue(null);

    const resultado = await importProductsFromExcel(
      libro([fila({ categoryId: 'cat-fantasma' })]),
      'store-1',
      'user-1'
    );

    expect(resultado.created).toBe(0);
    expect(resultado.errors).toEqual([
      {
        row: 2,
        field: 'general',
        message: expect.stringContaining('Categoría con ID cat-fantasma no encontrada'),
        value: 'ARROZ-1KG',
      },
    ]);
    expect(prismaMock.product.create).not.toHaveBeenCalled();
  });

  it('reporta la fila cuando el categoryId pertenece a otra tienda', async () => {
    prepararCreacion();
    prismaMock.category.findUnique.mockResolvedValue(
      categoryFixture({ id: 'cat-9', storeId: 'store-2' })
    );

    const resultado = await importProductsFromExcel(
      libro([fila({ categoryId: 'cat-9' })]),
      'store-1',
      'user-1'
    );

    expect(resultado.errors).toHaveLength(1);
    expect(resultado.errors[0]).toEqual(
      expect.objectContaining({ row: 2, field: 'general', value: 'ARROZ-1KG' })
    );
    expect(resultado.errors[0].message).toContain('no encontrada en esta tienda');
  });

  it('actualiza el producto existente de la misma tienda y fija su inventario', async () => {
    const existente = productFixture({ id: 'product-1', sku: 'ARROZ-1KG', storeId: 'store-1' });
    prismaMock.product.findUnique.mockResolvedValue(existente);
    prismaMock.product.update.mockResolvedValue(existente);
    prismaMock.inventory.upsert.mockResolvedValue({ id: 'inventory-1' });
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    const resultado = await importProductsFromExcel(
      libro([fila({ name: 'Arroz actualizado', costPrice: 2600, sellingPrice: 3700 })]),
      'store-1',
      'user-1'
    );

    expect(resultado).toEqual({ created: 0, updated: 1, errors: [], skipped: 0, total: 1 });
    expect(prismaMock.product.findUnique).toHaveBeenCalledWith({
      where: { sku: 'ARROZ-1KG' },
    });
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: {
        name: 'Arroz actualizado',
        description: null,
        presentacion: null,
        unidadVenta: 'UNIDAD',
        categoryId: null,
        costPrice: 2600,
        sellingPrice: 3700,
        sortOrder: 0,
        isActive: true,
        expirationDate: '2100-02-02T00:00:00Z',
      },
    });
    expect(prismaMock.inventory.upsert).toHaveBeenCalledWith({
      where: { storeId_productId: { storeId: 'store-1', productId: 'product-1' } },
      create: { storeId: 'store-1', productId: 'product-1', quantity: 0, lowStockThreshold: 5 },
      update: { quantity: 0, lowStockThreshold: 5 },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'UPDATE',
        entity: 'PRODUCT',
        entityId: 'product-1',
        metadata: expect.objectContaining({ sku: 'ARROZ-1KG', importSource: 'EXCEL' }),
      }),
    });
  });

  it('reporta la fila cuando el SKU ya existe en otra tienda', async () => {
    prepararCreacion();
    prismaMock.product.findUnique.mockResolvedValue(
      productFixture({ id: 'product-ajeno', storeId: 'store-2' })
    );

    const resultado = await importProductsFromExcel(
      libro([fila()]),
      'store-1',
      'user-1'
    );

    expect(resultado.updated).toBe(0);
    expect(resultado.errors).toEqual([
      {
        row: 2,
        field: 'general',
        message: expect.stringContaining('ya existe en otra tienda'),
        value: 'ARROZ-1KG',
      },
    ]);
    expect(prismaMock.product.update).not.toHaveBeenCalled();
    expect(prismaMock.product.create).not.toHaveBeenCalled();
  });

  it('reporta el SKU duplicado cuando la base de datos devuelve P2002', async () => {
    prepararCreacion();
    prismaMock.product.create.mockRejectedValue(prismaKnownError('P2002'));

    const resultado = await importProductsFromExcel(
      libro([fila({ sku: 'REPETIDO-1' })]),
      'store-1',
      'user-1'
    );

    expect(resultado.created).toBe(0);
    expect(resultado.errors).toEqual([
      { row: 2, field: 'sku', message: 'El SKU ya está registrado', value: 'REPETIDO-1' },
    ]);
  });

  it('reporta un error inesperado en una fila y sigue con las demás', async () => {
    prepararCreacion();
    prismaMock.product.create
      .mockRejectedValueOnce(new Error('se cayó la base'))
      .mockResolvedValue(productFixture({ id: 'product-9', sku: 'SKU-OK' }));

    const resultado = await importProductsFromExcel(
      libro([fila({ sku: 'SKU-ERROR' }), fila({ sku: 'SKU-OK' })]),
      'store-1',
      'user-1'
    );

    expect(resultado.total).toBe(2);
    expect(resultado.created).toBe(1);
    expect(resultado.errors).toEqual([
      {
        row: 2,
        field: 'general',
        message: 'Error inesperado al procesar la fila',
        value: 'SKU-ERROR',
      },
    ]);
  });

  it('acumula un error por cada campo requerido vacío', async () => {
    const resultado = await importProductsFromExcel(
      libro([fila({ name: '', sku: '', costPrice: '', sellingPrice: '', description: 'solo texto' })]),
      'store-1',
      'user-1'
    );

    expect(resultado.created).toBe(0);
    expect(resultado.errors.map((e) => [e.field, e.message])).toEqual([
      ['name', "Campo requerido 'name' está vacío"],
      ['sku', "Campo requerido 'sku' está vacío"],
      ['costPrice', "Campo requerido 'costPrice' está vacío"],
      ['sellingPrice', "Campo requerido 'sellingPrice' está vacío"],
    ]);
    expect(resultado.errors.every((e) => e.row === 2)).toBe(true);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('valida que el costo y el precio de venta sean coherentes', async () => {
    const resultado = await importProductsFromExcel(
      libro([
        fila({ sku: 'COSTO-CERO', costPrice: '0', sellingPrice: '15' }),
        fila({ sku: 'MARGEN-NEGATIVO', costPrice: '20', sellingPrice: '10' }),
        fila({ sku: 'PRECIO-NEGATIVO', costPrice: '10', sellingPrice: '-5' }),
      ]),
      'store-1',
      'user-1'
    );

    expect(resultado.errors.map((e) => [e.row, e.field, e.message])).toEqual([
      [2, 'costPrice', 'El costo debe ser mayor a 0'],
      [3, 'sellingPrice', 'El precio de venta debe ser mayor al costo'],
      [4, 'sellingPrice', 'El precio de venta debe ser mayor a 0'],
      [4, 'sellingPrice', 'El precio de venta debe ser mayor al costo'],
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('valida los campos opcionales con formato inválido', async () => {
    const resultado = await importProductsFromExcel(
      libro([
        fila({
          unidadVenta: 'CAJA',
          sortOrder: '1.5',
          lowStockThreshold: '-1',
          initialStock: '-2',
          isActive: 'quizá',
          expirationDate: '31/12/2030',
        }),
        fila({ sku: 'FECHA-IMPOSIBLE', expirationDate: '2030-13-45' }),
      ]),
      'store-1',
      'user-1'
    );

    expect(resultado.errors.map((e) => [e.field, e.message])).toEqual([
      ['unidadVenta', 'unidadVenta debe ser: UNIDAD, PESO o VOLUMEN'],
      ['sortOrder', 'sortOrder debe ser un entero >= 0'],
      ['lowStockThreshold', 'lowStockThreshold debe ser un entero >= 0'],
      ['initialStock', 'initialStock debe ser un número >= 0'],
      ['isActive', 'isActive debe ser true/false'],
      ['expirationDate', 'expirationDate debe tener formato YYYY-MM-DD'],
      ['expirationDate', 'expirationDate debe tener formato YYYY-MM-DD'],
    ]);
    expect(resultado.created).toBe(0);
  });

  it('interpreta isActive y unidadVenta sin distinguir mayúsculas', async () => {
    prepararCreacion();

    const resultado = await importProductsFromExcel(
      libro([
        fila({ sku: 'ACTIVO-1', isActive: 'sí', unidadVenta: 'volumen' }),
        fila({ sku: 'INACTIVO-1', isActive: '0', unidadVenta: 'Unidad' }),
      ]),
      'store-1',
      'user-1'
    );

    expect(resultado.created).toBe(2);
    const primero = prismaMock.product.create.mock.calls[0]?.[0]?.data as any;
    const segundo = prismaMock.product.create.mock.calls[1]?.[0]?.data as any;
    expect([primero.isActive, primero.unidadVenta]).toEqual([true, 'VOLUMEN']);
    expect([segundo.isActive, segundo.unidadVenta]).toEqual([false, 'UNIDAD']);
  });

  it('omite filas vacías y la fila de ejemplo de la plantilla', async () => {
    prepararCreacion();

    const resultado = await importProductsFromExcel(
      libro([
        fila({ name: '', sku: '', costPrice: '', sellingPrice: '' }),
        fila({ name: '   ', sku: '  ', costPrice: '', sellingPrice: '' }),
        fila({ name: 'EJEMPLO - NO IMPORTAR', sku: 'EJEMPLO-NO-IMPORTAR' }),
        fila({ name: 'EJEMPLO Arroz', sku: 'EJEMPLO-2' }),
        fila({ sku: 'REAL-1' }),
      ]),
      'store-1',
      'user-1'
    );

    expect(resultado).toEqual({ created: 1, updated: 0, errors: [], skipped: 4, total: 5 });
    expect(prismaMock.product.create).toHaveBeenCalledTimes(1);
  });

  it('lee la primera hoja cuando el libro no tiene una hoja "Productos"', async () => {
    prepararCreacion();

    const resultado = await importProductsFromExcel(
      libro([fila({ sku: 'OTRA-HOJA-1' })], { hoja: 'Hoja1' }),
      'store-1',
      'user-1'
    );

    expect(resultado.created).toBe(1);
    expect(prismaMock.product.create.mock.calls[0]?.[0]?.data).toEqual(
      expect.objectContaining({ sku: 'OTRA-HOJA-1' })
    );
  });

  it('mapea las columnas aunque vengan desordenadas y en mayúsculas', async () => {
    prepararCreacion();

    // Todas las columnas de la plantilla, en orden inverso, con espacios y mayúsculas.
    const columnasInvertidas = [...COLUMNAS].reverse();
    const encabezados = columnasInvertidas.map((columna) => ` ${columna.toUpperCase()} `);
    const valores = valoresFila({
      name: 'Bebida 1L',
      sku: 'BEBIDA-1',
      costPrice: '2000',
      sellingPrice: '3000',
    });

    const resultado = await importProductsFromExcel(
      libro([columnasInvertidas.map((columna) => valores[columna])], { encabezados }),
      'store-1',
      'user-1'
    );

    expect(resultado.created).toBe(1);
    expect(prismaMock.product.create.mock.calls[0]?.[0]?.data).toEqual(
      expect.objectContaining({
        name: 'Bebida 1L',
        sku: 'BEBIDA-1',
        costPrice: 2000,
        sellingPrice: 3000,
      })
    );
  });

  it('lanza INVALID_EXCEL_FILE cuando el buffer no es un Excel válido', async () => {
    const corrupto = Buffer.concat([
      Buffer.from('PK\x03\x04', 'binary'),
      Buffer.from('basurabasura'),
    ]);

    await expectApiError(() => importProductsFromExcel(corrupto, 'store-1', 'user-1'), {
      status: 400,
      code: 'INVALID_EXCEL_FILE',
      message: /No se pudo leer el archivo Excel/,
    });
  });

  it('lanza EMPTY_EXCEL_FILE cuando el libro no tiene hojas', async () => {
    // Caso imposible de serializar con SheetJS: el libro se simula desde `read`.
    vi.mocked(XLSX.read).mockReturnValueOnce({ SheetNames: [], Sheets: {} } as any);

    await expectApiError(
      () => importProductsFromExcel(Buffer.from('cualquier cosa'), 'store-1', 'user-1'),
      { status: 400, code: 'EMPTY_EXCEL_FILE', message: /no contiene hojas/ }
    );
  });

  it('lanza NO_DATA_ROWS cuando solo hay encabezados', async () => {
    await expectApiError(() => importProductsFromExcel(libro([]), 'store-1', 'user-1'), {
      status: 400,
      code: 'NO_DATA_ROWS',
      message: /al menos una fila de encabezados y una fila de datos/,
    });
  });

  it('lanza MISSING_COLUMNS cuando falta una columna de la plantilla', async () => {
    const encabezados = COLUMNAS.filter((columna) => columna !== 'sku' && columna !== 'isActive');

    await expectApiError(
      () =>
        importProductsFromExcel(
          libro([['Arroz', 2500, 3500]], { encabezados }),
          'store-1',
          'user-1'
        ),
      { status: 400, code: 'MISSING_COLUMNS', message: /sku, isActive/ }
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
