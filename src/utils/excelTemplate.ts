import * as XLSX from 'xlsx';

interface CellStyle {
  font?: { bold?: boolean; color?: { rgb: string }; size?: number; italic?: boolean };
  fill?: { fgColor: { rgb: string } };
  alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean };
  border?: {
    top?: { style: string; color: { rgb: string } };
    bottom?: { style: string; color: { rgb: string } };
    left?: { style: string; color: { rgb: string } };
    right?: { style: string; color: { rgb: string } };
  };
}

export interface ExcelTemplateColumn {
  header: string;
  key: string;
  width: number;
  required: boolean;
  description: string;
  example?: string;
}

export const PRODUCT_TEMPLATE_COLUMNS: ExcelTemplateColumn[] = [
  { header: 'name', key: 'name', width: 30, required: true, description: 'Nombre del producto (requerido)', example: 'Arroz Blanco 1kg' },
  { header: 'sku', key: 'sku', width: 20, required: true, description: 'Código único (SKU o código de barras). Si vacío, se genera automático (PRODUCT-001)', example: 'ARROZ-1KG' },
  { header: 'description', key: 'description', width: 40, required: false, description: 'Descripción opcional (máx 500 caracteres)', example: 'Arroz blanco grano largo, paquete 1kg' },
  { header: 'presentacion', key: 'presentacion', width: 15, required: false, description: 'Presentación (ej: CH, MD, GD, 500g, 1L - máx 50 caracteres)', example: '1 KG' },
  { header: 'unidadVenta', key: 'unidadVenta', width: 15, required: false, description: 'Tipo de venta: UNIDAD (por pieza), PESO (por kg), VOLUMEN (por litro). Default: UNIDAD', example: 'UNIDAD' },
  { header: 'categoryId', key: 'categoryId', width: 25, required: false, description: 'ID de categoría existente (ver hoja "Categorías"). Opcional si usa categoryName', example: 'clx123abc456' },
  { header: 'categoryName', key: 'categoryName', width: 25, required: false, description: 'Nombre de categoría (se crea si no existe y no hay categoryId). Opcional', example: 'Abarrotes' },
  { header: 'costPrice', key: 'costPrice', width: 15, required: true, description: 'Costo unitario en COP (requerido, 2 decimales)', example: '2500.00' },
  { header: 'sellingPrice', key: 'sellingPrice', width: 15, required: true, description: 'Precio de venta en COP (requerido, 2 decimales). Debe ser > costo', example: '3500.00' },
  { header: 'sortOrder', key: 'sortOrder', width: 12, required: false, description: 'Prioridad en catálogo (menor = mayor prioridad). Default: 0', example: '0' },
  { header: 'lowStockThreshold', key: 'lowStockThreshold', width: 18, required: false, description: 'Umbral de stock bajo para alertas (entero >= 0). Default: 5', example: '5' },
  { header: 'isActive', key: 'isActive', width: 12, required: false, description: 'Activo para venta: true/false. Default: true. Inactivos no aparecen en POS', example: 'true' },
  { header: 'initialStock', key: 'initialStock', width: 15, required: false, description: 'Cantidad inicial de inventario (entero o decimal >= 0). Default: 0', example: '100' },
];

export interface CategoryRef {
  id: string;
  name: string;
}

export interface UnidadVentaRef {
  value: string;
  descripcion: string;
  precioPor: string;
}

const UNIDAD_VENTA_CATALOG: UnidadVentaRef[] = [
  { value: 'UNIDAD', descripcion: 'Venta por unidad/bulto/paquete (cantidad entera)', precioPor: 'Unidad' },
  { value: 'PESO', descripcion: 'Venta a granel por peso (ej: arroz, frutas, verduras)', precioPor: 'Kilogramo (kg)' },
  { value: 'VOLUMEN', descripcion: 'Venta a granel por volumen (ej: líquidos, aceites, bebidas)', precioPor: 'Litro (L)' },
];

function createHeaderStyle(): CellStyle {
  return {
    font: { bold: true, color: { rgb: 'FFFFFF' }, size: 11 },
    fill: { fgColor: { rgb: '1E6A3C' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } },
    },
  };
}

function createDataStyle(): CellStyle {
  return {
    font: { size: 11 },
    alignment: { vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'CCCCCC' } },
      bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
      left: { style: 'thin', color: { rgb: 'CCCCCC' } },
      right: { style: 'thin', color: { rgb: 'CCCCCC' } },
    },
  };
}

function createRequiredStyle(): CellStyle {
  const base = createDataStyle();
  return {
    ...base,
    fill: { fgColor: { rgb: 'FFF3E0' } },
  };
}

function createExampleStyle(): CellStyle {
  const base = createDataStyle();
  return {
    ...base,
    font: { ...base.font, italic: true, color: { rgb: '999999' } },
    fill: { fgColor: { rgb: 'F5F5F5' } },
  };
}

export function generateProductExcelTemplate(categories: CategoryRef[] = []): Buffer {
  const wb = XLSX.utils.book_new();

  const wsData: (string | number)[][] = [];

  wsData.push(PRODUCT_TEMPLATE_COLUMNS.map((c) => c.header));

  const exampleRow1 = PRODUCT_TEMPLATE_COLUMNS.map((c) => c.example ?? '');
  wsData.push(exampleRow1);

  const exampleRow2 = PRODUCT_TEMPLATE_COLUMNS.map((c) => {
    if (c.key === 'name') return 'Arroz Blanco 1kg';
    if (c.key === 'sku') return 'ARROZ-1KG';
    if (c.key === 'description') return 'Arroz blanco grano largo, paquete 1kg';
    if (c.key === 'presentacion') return '1 KG';
    if (c.key === 'unidadVenta') return 'UNIDAD';
    if (c.key === 'categoryName') return 'Abarrotes';
    if (c.key === 'costPrice') return '2500.00';
    if (c.key === 'sellingPrice') return '3500.00';
    if (c.key === 'sortOrder') return '0';
    if (c.key === 'lowStockThreshold') return '5';
    if (c.key === 'isActive') return 'true';
    if (c.key === 'initialStock') return '100';
    return '';
  });
  wsData.push(exampleRow2);

  const exampleRow3 = PRODUCT_TEMPLATE_COLUMNS.map((c) => {
    if (c.key === 'name') return 'EJEMPLO - NO IMPORTAR';
    if (c.key === 'sku') return 'EJEMPLO-NO-IMPORTAR';
    return '';
  });
  wsData.push(exampleRow3);

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  PRODUCT_TEMPLATE_COLUMNS.forEach((col, idx) => {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: idx });
    if (!ws[cellAddress]) ws[cellAddress] = { v: col.header, t: 's' };
    ws[cellAddress].s = createHeaderStyle();
    ws[cellAddress].c = [{ a: 'Servicaja POS', t: `${col.description}${col.required ? ' (REQUERIDO)' : ''}` }];
  });

  for (let row = 1; row <= 3; row++) {
    PRODUCT_TEMPLATE_COLUMNS.forEach((col, idx) => {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: idx });
      if (!ws[cellAddress]) return;
      if (row === 1) {
        ws[cellAddress].s = createExampleStyle();
      } else if (row === 3) {
        ws[cellAddress].s = {
          ...createDataStyle(),
          font: { ...createDataStyle().font, bold: true, color: { rgb: 'CC0000' } },
          fill: { fgColor: { rgb: 'FFF0F0' } },
        };
      } else {
        ws[cellAddress].s = col.required ? createRequiredStyle() : createDataStyle();
      }
    });
  }

  const colWidths = PRODUCT_TEMPLATE_COLUMNS.map((c) => ({ wch: c.width }));
  ws['!cols'] = colWidths;

  ws['!rows'] = [
    { hpt: 35 },
    { hpt: 25 },
    { hpt: 25 },
    { hpt: 25 },
  ];

  const categoriesData: (string | number)[][] = [
    ['ID', 'Nombre'],
    ...categories.map((c) => [c.id, c.name]),
  ];

  const wsCategories = XLSX.utils.aoa_to_sheet(categoriesData);
  wsCategories['!cols'] = [
    { wch: 30 },
    { wch: 30 },
  ];
  const catHeaderStyle = createHeaderStyle();
  ['A1', 'B1'].forEach((cell) => {
    if (wsCategories[cell]) wsCategories[cell].s = catHeaderStyle;
  });
  XLSX.utils.book_append_sheet(wb, wsCategories, 'Categorías');

  const unidadVentaData: (string | number)[][] = [
    ['Valor', 'Descripción', 'Precio por'],
    ...UNIDAD_VENTA_CATALOG.map((u) => [u.value, u.descripcion, u.precioPor]),
  ];

  const wsUnidadVenta = XLSX.utils.aoa_to_sheet(unidadVentaData);
  wsUnidadVenta['!cols'] = [
    { wch: 15 },
    { wch: 55 },
    { wch: 20 },
  ];
  const uvHeaderStyle = createHeaderStyle();
  ['A1', 'B1', 'C1'].forEach((cell) => {
    if (wsUnidadVenta[cell]) wsUnidadVenta[cell].s = uvHeaderStyle;
  });
  XLSX.utils.book_append_sheet(wb, wsUnidadVenta, 'UnidadVenta');

  const instructionsData = [
    ['INSTRUCCIONES DE USO'],
    [''],
    ['1. Complete las columnas requeridas (fondo naranja): name, sku, costPrice, sellingPrice'],
    ['2. El SKU debe ser único por tienda. Si el SKU ya existe, se actualiza el producto (idempotencia).'],
    ['3. Use categoryId O categoryName (no ambos). Si usa categoryName y no existe, se creará.'],
    ['   Consulte la hoja "Categorías" para IDs y nombres existentes.'],
    ['4. unidadVenta: UNIDAD (por pieza), PESO (por kg), VOLUMEN (por litro). Default: UNIDAD'],
    ['   Consulte la hoja "UnidadVenta" para valores permitidos y descripción.'],
    ['5. costPrice y sellingPrice en COP con 2 decimales. sellingPrice debe ser > costPrice.'],
    ['6. sortOrder: prioridad en catálogo (menor = mayor prioridad). Default: 0'],
    ['7. lowStockThreshold: umbral de stock bajo para alertas (entero >= 0). Default: 5'],
    ['8. isActive: true/false. Default: true. Productos inactivos no aparecen en POS.'],
    ['9. initialStock: cantidad inicial de inventario (>= 0). Default: 0'],
    ['10. La fila 4 (EJEMPLO - NO IMPORTAR) se ignora automáticamente al importar.'],
    ['11. No elimine ni reordene las columnas. Mantenga los encabezados exactos.'],
    ['12. Guarde como .xlsx y cárguelo en Productos > Importar Excel.'],
  ];

  const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData);
  wsInstructions['!cols'] = [{ wch: 90 }];

  // Orden de pestañas: Productos, Categorías, UnidadVenta, Instrucciones
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  XLSX.utils.book_append_sheet(wb, wsCategories, 'Categorías');
  XLSX.utils.book_append_sheet(wb, wsUnidadVenta, 'UnidadVenta');
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instrucciones');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}