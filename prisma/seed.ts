import "dotenv/config";
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const prisma = new PrismaClient({ adapter });

async function main() {
  const store = await prisma.store.upsert({
    where: { code: 'STORE001' },
    update: {},
    create: { name: 'Tienda Central', code: 'STORE001', address: 'Av. Principal 123', phone: '555-1234', codigoPostal: '11001' },
  });

  const adminPassword = await bcrypt.hash('admin123', 10);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@servicaja.com' },
    update: {},
    create: {
      email: 'admin@servicaja.com',
      password: adminPassword,
      name: 'Administrador',
      role: 'ADMIN',
    },
  });

  await prisma.userStore.upsert({
    where: { userId_storeId: { userId: adminUser.id, storeId: store.id } },
    update: {},
    create: { userId: adminUser.id, storeId: store.id, role: 'ADMIN', isPrimary: true },
  });

  const categoriasBase = [
    'General',
    'Alimentos básicos',
    'Abarrotes comestibles',
    'Bebidas',
    'Lácteos',
    'Limpieza',
    'Artículos de uso personal',
  ];

  const categories: Array<{ id: string; name: string }> = [];
  for (const nombre of categoriasBase) {
    const category = await prisma.category.upsert({
      where: { name_storeId: { name: nombre, storeId: store.id } },
      update: {},
      create: { name: nombre, storeId: store.id },
    });
    categories.push(category);
  }

  // ─── Motivos de movimiento de inventario (editables luego) ──
  const motivosBase: Array<{
    name: string;
    tipo: 'ENTRADA' | 'SALIDA';
    departamento?: string | null;
  }> = [
      // ENTRADA (suma stock)
      { name: 'Ajuste positivo (conteo físico)', tipo: 'ENTRADA' },
      { name: 'Devolución de cliente', tipo: 'ENTRADA' },
      { name: 'Producto reubicado o encontrado', tipo: 'ENTRADA' },
      { name: 'Compra no registrada', tipo: 'ENTRADA' },
      { name: 'Compra a proveedor', tipo: 'ENTRADA' },
      // SALIDA (resta stock: merma, pérdida, etc.)
      { name: 'Merma / producto echado a perder', tipo: 'SALIDA', departamento: 'Abarrotes' },
      { name: 'Caducado / vencido', tipo: 'SALIDA' },
      { name: 'Rotura / daño accidental', tipo: 'SALIDA' },
      { name: 'Robo / extravío', tipo: 'SALIDA' },
      { name: 'Venta no registrada', tipo: 'SALIDA' },
      { name: 'Degustación / muestra', tipo: 'SALIDA' },
      { name: 'Traslado a otra sucursal', tipo: 'SALIDA' },
      { name: 'Error de captura en venta', tipo: 'SALIDA' },
      { name: 'Cancelación de compra', tipo: 'SALIDA' },
    ];

  for (const m of motivosBase) {
    await prisma.movementReason.upsert({
      where: { storeId_name: { storeId: store.id, name: m.name } },
      update: {},
      create: {
        storeId: store.id,
        name: m.name,
        tipo: m.tipo,
        departamento: m.departamento ?? null,
        isActive: true,
      },
    });
  }

  // ─── Cajas de ejemplo (módulo de control de cajas, opcional) ──
  const cajasBase = ['Caja 1', 'Caja 2'];
  for (const nombre of cajasBase) {
    await prisma.caja.upsert({
      where: { storeId_name: { storeId: store.id, name: nombre } },
      update: {},
      create: {
        storeId: store.id,
        name: nombre,
        isActive: true,
      },
    });
  }

  // ─── Motivos de movimientos de caja (inyección / retiro) ──
  const motivosCajaBase = [
    { tipo: 'INGRESO', name: 'Fondo de caja' },
    { tipo: 'INGRESO', name: 'Cambio de turno' },
    { tipo: 'INGRESO', name: 'Devolución a caja' },
    { tipo: 'INGRESO', name: 'Depósito transferencia' },
    { tipo: 'INGRESO', name: 'Pago con tarjeta' },
    { tipo: 'INGRESO', name: 'Otro' },
    { tipo: 'EGRESO', name: 'Retiro de feria' },
    { tipo: 'EGRESO', name: 'Pago a proveedor' },
    { tipo: 'EGRESO', name: 'Gasto menor' },
    { tipo: 'EGRESO', name: 'Transferencia a banco' },
    { tipo: 'EGRESO', name: 'Cambio de caja' },
    { tipo: 'EGRESO', name: 'Otro' },
  ];
  for (const m of motivosCajaBase) {
    await prisma.cajaMovimientoMotivo.upsert({
      where: { storeId_name: { storeId: store.id, name: m.name } },
      update: { tipo: m.tipo },
      create: { storeId: store.id, tipo: m.tipo, name: m.name, isActive: true },
    });
  }

  // ─── Motivos de cancelación (editables luego desde el módulo de cancelaciones) ──
  const motivosCancelacionBase = [
    'Error de facturación',
    'Cliente/proveedor solicita anular',
    'Duplicada',
    'Devolución de mercancía',
    'Reembolso al cliente',
    'Cancelación de pedido',
    'Otro',
  ];

  for (const nombre of motivosCancelacionBase) {
    await prisma.cancellationReason.upsert({
      where: { storeId_name: { storeId: store.id, name: nombre } },
      update: {},
      create: {
        storeId: store.id,
        name: nombre,
        isActive: true,
      },
    });
  }

  // Helper: crear producto + inventario
  async function crearProducto(p: {
    sku: string;
    name: string;
    presentacion?: string | null;
    description?: string;
    unidadVenta?: 'UNIDAD' | 'PESO' | 'VOLUMEN';
    categoryIndex: number;
    costPrice: number;
    sellingPrice: number;
    stock: number;
    sortOrder: number;
  }) {
    const creado = await prisma.product.upsert({
      where: { sku: p.sku },
      update: { sortOrder: p.sortOrder },
      create: {
        name: p.name,
        sku: p.sku,
        description: p.description,
        presentacion: p.presentacion ?? null,
        unidadVenta: p.unidadVenta ?? 'UNIDAD',
        storeId: store.id,
        categoryId: categories[p.categoryIndex].id,
        costPrice: p.costPrice,
        sellingPrice: p.sellingPrice,
        sortOrder: p.sortOrder,
      },
    });
    await prisma.inventory.upsert({
      where: { storeId_productId: { storeId: store.id, productId: creado.id } },
      update: { quantity: p.stock },
      create: {
        storeId: store.id,
        productId: creado.id,
        quantity: p.stock,
        lowStockThreshold: 5,
      },
    });
  }

  // ============================================================
  // 100 PRODUCTOS — Orden por "más vendido" (consumo diario primero)
  // ============================================================

  // ─── LÁCTEOS (15) — categoría[4] ──────────────────────────
  const lacteos = [
    { sku: 'LAC-001', name: 'Leche Entera', presentacion: null, description: 'Leche entera 1L', unidadVenta: 'UNIDAD' as const, costPrice: 2800, sellingPrice: 3400, stock: 48, sortOrder: 100 },
    { sku: 'LAC-002', name: 'Leche Descremada', presentacion: null, description: 'Leche descremada 1L', unidadVenta: 'UNIDAD' as const, costPrice: 2600, sellingPrice: 3200, stock: 52, sortOrder: 101 },
    { sku: 'LAC-003', name: 'Yogurt Natural', presentacion: null, description: 'Yogurt natural 1kg', unidadVenta: 'PESO' as const, costPrice: 7500, sellingPrice: 9200, stock: 18.5, sortOrder: 102 },
    { sku: 'LAC-004', name: 'Queso Cheddar', presentacion: null, description: 'Queso cheddar en lonchas 200g', unidadVenta: 'UNIDAD' as const, costPrice: 4200, sellingPrice: 5800, stock: 30, sortOrder: 103 },
    { sku: 'LAC-005', name: 'Queso Mozzarella', presentacion: null, description: 'Queso mozzarella 250g', unidadVenta: 'UNIDAD' as const, costPrice: 3800, sellingPrice: 5200, stock: 25, sortOrder: 104 },
    { sku: 'LAC-006', name: 'Mantequilla', presentacion: null, description: 'Mantequilla sin sal 250g', unidadVenta: 'UNIDAD' as const, costPrice: 5500, sellingPrice: 7200, stock: 22, sortOrder: 105 },
    { sku: 'LAC-007', name: 'Crema de Leche', presentacion: null, description: 'Crema de leche 250ml', unidadVenta: 'VOLUMEN' as const, costPrice: 3200, sellingPrice: 4500, stock: 40, sortOrder: 106 },
    { sku: 'LAC-008', name: 'Leche Condensada', presentacion: null, description: 'Leche condensada 370g', unidadVenta: 'UNIDAD' as const, costPrice: 4800, sellingPrice: 6500, stock: 35, sortOrder: 107 },
    { sku: 'LAC-009', name: 'Kumis', presentacion: null, description: 'Kumis natural 500ml', unidadVenta: 'VOLUMEN' as const, costPrice: 2200, sellingPrice: 3200, stock: 60, sortOrder: 108 },
    { sku: 'LAC-010', name: 'Helado Vainilla', presentacion: null, description: 'Helado sabor vainilla 500ml', unidadVenta: 'VOLUMEN' as const, costPrice: 4500, sellingPrice: 6800, stock: 15, sortOrder: 109 },
    { sku: 'LAC-011', name: 'Helado Chocolate', presentacion: null, description: 'Helado sabor chocolate 500ml', unidadVenta: 'VOLUMEN' as const, costPrice: 4500, sellingPrice: 6800, stock: 14, sortOrder: 110 },
    { sku: 'LAC-012', name: 'Requesón', presentacion: null, description: 'Requesón fresco 200g', unidadVenta: 'UNIDAD' as const, costPrice: 2800, sellingPrice: 3800, stock: 20, sortOrder: 111 },
    { sku: 'LAC-013', name: 'Queso Campesino', presentacion: null, description: 'Queso campesino 500g', unidadVenta: 'PESO' as const, costPrice: 6000, sellingPrice: 8500, stock: 12, sortOrder: 112 },
    { sku: 'LAC-014', name: 'Nata', presentacion: null, description: 'Nata para cocinar 200ml', unidadVenta: 'VOLUMEN' as const, costPrice: 3500, sellingPrice: 4800, stock: 28, sortOrder: 113 },
    { sku: 'LAC-015', name: 'Yogurt de Fresa', presentacion: null, description: 'Yogurt sabor fresa 170g', unidadVenta: 'UNIDAD' as const, costPrice: 1200, sellingPrice: 1800, stock: 60, sortOrder: 114 },
  ];

  for (const p of lacteos) {
    await crearProducto({ ...p, categoryIndex: 4 });
  }

  // ─── BEBIDAS (15) — categoría[3] ──────────────────────────
  const bebidas = [
    { sku: 'BEB-001', name: 'Agua Botella', presentacion: null, description: 'Agua purificada 600ml', unidadVenta: 'UNIDAD' as const, costPrice: 800, sellingPrice: 1500, stock: 80, sortOrder: 200 },
    { sku: 'BEB-002', name: 'Gaseosa Cola', presentacion: null, description: 'Gaseosa cola 2L', unidadVenta: 'UNIDAD' as const, costPrice: 3800, sellingPrice: 5200, stock: 30, sortOrder: 201 },
    { sku: 'BEB-003', name: 'Gaseosa Limón', presentacion: null, description: 'Gaseosa limón 2L', unidadVenta: 'UNIDAD' as const, costPrice: 3600, sellingPrice: 5000, stock: 28, sortOrder: 202 },
    { sku: 'BEB-004', name: 'Jugo de Naranja', presentacion: null, description: 'Jugo natural de naranja 1L', unidadVenta: 'VOLUMEN' as const, costPrice: 3200, sellingPrice: 4800, stock: 25, sortOrder: 203 },
    { sku: 'BEB-005', name: 'Jugo de Mango', presentacion: null, description: 'Jugo de mango 1L', unidadVenta: 'VOLUMEN' as const, costPrice: 3500, sellingPrice: 5000, stock: 22, sortOrder: 204 },
    { sku: 'BEB-006', name: 'Agua de Coco', presentacion: null, description: 'Agua de coco 500ml', unidadVenta: 'VOLUMEN' as const, costPrice: 2500, sellingPrice: 3800, stock: 36, sortOrder: 205 },
    { sku: 'BEB-007', name: 'Limonada Natural', presentacion: null, description: 'Limonada natural preparada 1L', unidadVenta: 'VOLUMEN' as const, costPrice: 2000, sellingPrice: 3500, stock: 20, sortOrder: 206 },
    { sku: 'BEB-008', name: 'Colombiana', presentacion: null, description: 'Gaseosa colombiana 1.5L', unidadVenta: 'UNIDAD' as const, costPrice: 3200, sellingPrice: 4500, stock: 24, sortOrder: 207 },
    { sku: 'BEB-009', name: 'Manzana Postobón', presentacion: null, description: 'Gaseosa manzana 1.5L', unidadVenta: 'UNIDAD' as const, costPrice: 3000, sellingPrice: 4200, stock: 26, sortOrder: 208 },
    { sku: 'BEB-010', name: 'Sprite', presentacion: null, description: 'Gaseosa sprite 2L', unidadVenta: 'UNIDAD' as const, costPrice: 3600, sellingPrice: 5000, stock: 30, sortOrder: 209 },
    { sku: 'BEB-011', name: 'Energizante', presentacion: null, description: 'Energizante 473ml', unidadVenta: 'VOLUMEN' as const, costPrice: 3500, sellingPrice: 5500, stock: 35, sortOrder: 210 },
    { sku: 'BEB-012', name: 'Café Molido', presentacion: null, description: 'Café molido premium 500g', unidadVenta: 'PESO' as const, costPrice: 12000, sellingPrice: 16500, stock: 15, sortOrder: 211 },
    { sku: 'BEB-013', name: 'Té Verde', presentacion: null, description: 'Té verde en saquitos 20u', unidadVenta: 'UNIDAD' as const, costPrice: 3200, sellingPrice: 4800, stock: 40, sortOrder: 212 },
    { sku: 'BEB-014', name: 'Aperitivo', presentacion: null, description: 'Aperitivo 750ml', unidadVenta: 'VOLUMEN' as const, costPrice: 8500, sellingPrice: 12000, stock: 18, sortOrder: 213 },
    { sku: 'BEB-015', name: 'Soda Italiana', presentacion: null, description: 'Soda italiana 350ml', unidadVenta: 'VOLUMEN' as const, costPrice: 1500, sellingPrice: 2200, stock: 48, sortOrder: 214 },
  ];

  for (const p of bebidas) {
    await crearProducto({ ...p, categoryIndex: 3 });
  }

  // ─── ALIMENTOS BÁSICOS (15) — categoría[1] ────────────────
  const alimentos = [
    { sku: 'ALI-001', name: 'Arroz', presentacion: null, description: 'Arroz blanco 1kg', unidadVenta: 'UNIDAD' as const, costPrice: 2800, sellingPrice: 3600, stock: 60, sortOrder: 300 },
    { sku: 'ALI-002', name: 'Frijol Rojo', presentacion: null, description: 'Frijol rojo 1kg', unidadVenta: 'UNIDAD' as const, costPrice: 3200, sellingPrice: 4200, stock: 45, sortOrder: 301 },
    { sku: 'ALI-003', name: 'Frijol Blanco', presentacion: null, description: 'Frijol blanco 1kg', unidadVenta: 'UNIDAD' as const, costPrice: 3000, sellingPrice: 4000, stock: 40, sortOrder: 302 },
    { sku: 'ALI-004', name: 'Lenteja', presentacion: null, description: 'Lenteja 500g', unidadVenta: 'UNIDAD' as const, costPrice: 2600, sellingPrice: 3500, stock: 35, sortOrder: 303 },
    { sku: 'ALI-005', name: 'Garbanzo', presentacion: null, description: 'Garbanzo 500g', unidadVenta: 'UNIDAD' as const, costPrice: 3800, sellingPrice: 5200, stock: 25, sortOrder: 304 },
    { sku: 'ALI-006', name: 'Azúcar', presentacion: null, description: 'Azúcar 1kg', unidadVenta: 'UNIDAD' as const, costPrice: 2200, sellingPrice: 3000, stock: 55, sortOrder: 305 },
    { sku: 'ALI-007', name: 'Sal', presentacion: null, description: 'Sal refinada 500g', unidadVenta: 'UNIDAD' as const, costPrice: 800, sellingPrice: 1400, stock: 70, sortOrder: 306 },
    { sku: 'ALI-008', name: 'Aceite Vegetal', presentacion: null, description: 'Aceite vegetal 1L', unidadVenta: 'VOLUMEN' as const, costPrice: 5500, sellingPrice: 7200, stock: 18, sortOrder: 307 },
    { sku: 'ALI-009', name: 'Pasta Spaghetti', presentacion: null, description: 'Pasta espagueti 500g', unidadVenta: 'UNIDAD' as const, costPrice: 1800, sellingPrice: 2600, stock: 50, sortOrder: 308 },
    { sku: 'ALI-010', name: 'Pasta Penne', presentacion: null, description: 'Pasta penne 500g', unidadVenta: 'UNIDAD' as const, costPrice: 1800, sellingPrice: 2600, stock: 45, sortOrder: 309 },
    { sku: 'ALI-011', name: 'Salsa de Tomate', presentacion: null, description: 'Salsa de tomate 400g', unidadVenta: 'UNIDAD' as const, costPrice: 2500, sellingPrice: 3500, stock: 40, sortOrder: 310 },
    { sku: 'ALI-012', name: 'Salsa de Ají', presentacion: null, description: 'Salsa de ají picante 250ml', unidadVenta: 'VOLUMEN' as const, costPrice: 2200, sellingPrice: 3200, stock: 30, sortOrder: 311 },
    { sku: 'ALI-013', name: 'Cebolla', presentacion: null, description: 'Cebolla cabezona 1lb', unidadVenta: 'PESO' as const, costPrice: 1500, sellingPrice: 2200, stock: 20, sortOrder: 312 },
    { sku: 'ALI-014', name: 'Tomate', presentacion: null, description: 'Tomate de mesa 1lb', unidadVenta: 'PESO' as const, costPrice: 1800, sellingPrice: 2600, stock: 18, sortOrder: 313 },
    { sku: 'ALI-015', name: 'Papa', presentacion: null, description: 'Papa pastusa 1kg', unidadVenta: 'PESO' as const, costPrice: 2400, sellingPrice: 3200, stock: 25, sortOrder: 314 },
  ];

  for (const p of alimentos) {
    await crearProducto({ ...p, categoryIndex: 1 });
  }

  // ─── ABARROTES (15) — categoría[2] ────────────────────────
  const abarrotes = [
    { sku: 'ABAR-001', name: 'Galletas Moore', presentacion: null, description: 'Galletas de soda 400g', unidadVenta: 'UNIDAD' as const, costPrice: 2500, sellingPrice: 3400, stock: 50, sortOrder: 400 },
    { sku: 'ABAR-002', name: 'Galletas Saltin', presentacion: null, description: 'Galletas saltin 180g', unidadVenta: 'UNIDAD' as const, costPrice: 1800, sellingPrice: 2500, stock: 60, sortOrder: 401 },
    { sku: 'ABAR-003', name: 'Papa Frita', presentacion: null, description: 'Papa frita chips 45g', unidadVenta: 'UNIDAD' as const, costPrice: 1200, sellingPrice: 1800, stock: 80, sortOrder: 402 },
    { sku: 'ABAR-004', name: 'Pony Malta', presentacion: null, description: 'Pony Malta lata 330ml', unidadVenta: 'VOLUMEN' as const, costPrice: 1500, sellingPrice: 2200, stock: 72, sortOrder: 403 },
    { sku: 'ABAR-005', name: 'Panela', presentacion: null, description: 'Panela pilada 500g', unidadVenta: 'UNIDAD' as const, costPrice: 2800, sellingPrice: 3800, stock: 35, sortOrder: 404 },
    { sku: 'ABAR-006', name: 'Cacao en Polvo', presentacion: null, description: 'Cacao en polvo 200g', unidadVenta: 'UNIDAD' as const, costPrice: 4500, sellingPrice: 6200, stock: 28, sortOrder: 405 },
    { sku: 'ABAR-007', name: 'Avena', presentacion: null, description: 'Avena en hojuelas 500g', unidadVenta: 'UNIDAD' as const, costPrice: 2200, sellingPrice: 3000, stock: 40, sortOrder: 406 },
    { sku: 'ABAR-008', name: 'Harina de Trigo', presentacion: null, description: 'Harina de trigo 1kg', unidadVenta: 'UNIDAD' as const, costPrice: 2000, sellingPrice: 2800, stock: 38, sortOrder: 407 },
    { sku: 'ABAR-009', name: 'Maicena', presentacion: null, description: 'Maicena 500g', unidadVenta: 'UNIDAD' as const, costPrice: 2500, sellingPrice: 3500, stock: 25, sortOrder: 408 },
    { sku: 'ABAR-010', name: 'Atún', presentacion: null, description: 'Atún en agua 170g', unidadVenta: 'UNIDAD' as const, costPrice: 2800, sellingPrice: 3800, stock: 42, sortOrder: 409 },
    { sku: 'ABAR-011', name: 'Sardina', presentacion: null, description: 'Sardina en salsa 155g', unidadVenta: 'UNIDAD' as const, costPrice: 1800, sellingPrice: 2600, stock: 35, sortOrder: 410 },
    { sku: 'ABAR-012', name: 'Chocoramo', presentacion: null, description: 'Chocoramo 60g', unidadVenta: 'UNIDAD' as const, costPrice: 900, sellingPrice: 1400, stock: 90, sortOrder: 411 },
    { sku: 'ABAR-013', name: 'Pandebono', presentacion: null, description: 'Pandebono 500g', unidadVenta: 'PESO' as const, costPrice: 4500, sellingPrice: 6500, stock: 12, sortOrder: 412 },
    { sku: 'ABAR-014', name: 'Empanada', presentacion: null, description: 'Empanada de carne uds', unidadVenta: 'UNIDAD' as const, costPrice: 1200, sellingPrice: 2000, stock: 24, sortOrder: 413 },
    { sku: 'ABAR-015', name: 'Pan Francés', presentacion: null, description: 'Pan francés uds', unidadVenta: 'UNIDAD' as const, costPrice: 300, sellingPrice: 600, stock: 50, sortOrder: 414 },
  ];

  for (const p of abarrotes) {
    await crearProducto({ ...p, categoryIndex: 2 });
  }

  // ─── LIMPIEZA (15) — categoría[5] ─────────────────────────
  const limpieza = [
    { sku: 'LIMP-001', name: 'Jabón Rey', presentacion: null, description: 'Jabón rey en barra 170g', unidadVenta: 'UNIDAD' as const, costPrice: 1500, sellingPrice: 2200, stock: 60, sortOrder: 500 },
    { sku: 'LIMP-002', name: 'Jabón Líquido', presentacion: null, description: 'Jabón líquido manos 500ml', unidadVenta: 'VOLUMEN' as const, costPrice: 3500, sellingPrice: 5000, stock: 30, sortOrder: 501 },
    { sku: 'LIMP-003', name: 'Cloro', presentacion: null, description: 'Cloro desinfectante 1L', unidadVenta: 'VOLUMEN' as const, costPrice: 2200, sellingPrice: 3200, stock: 45, sortOrder: 502 },
    { sku: 'LIMP-004', name: 'Detégel', presentacion: null, description: 'Líquido lavavajillas 500ml', unidadVenta: 'VOLUMEN' as const, costPrice: 3200, sellingPrice: 4500, stock: 35, sortOrder: 503 },
    { sku: 'LIMP-005', name: 'Fabuloso', presentacion: null, description: 'Limpiador multiusos 1L', unidadVenta: 'VOLUMEN' as const, costPrice: 4200, sellingPrice: 5800, stock: 28, sortOrder: 504 },
    { sku: 'LIMP-006', name: 'Suavizante', presentacion: null, description: 'Suavizante de ropa 1L', unidadVenta: 'VOLUMEN' as const, costPrice: 5500, sellingPrice: 7500, stock: 22, sortOrder: 505 },
    { sku: 'LIMP-007', name: 'Detergente', presentacion: null, description: 'Detergente en polvo 1kg', unidadVenta: 'UNIDAD' as const, costPrice: 4800, sellingPrice: 6500, stock: 32, sortOrder: 506 },
    { sku: 'LIMP-008', name: 'Limpiapisos', presentacion: null, description: 'Limpiador de pisos 1L', unidadVenta: 'VOLUMEN' as const, costPrice: 3800, sellingPrice: 5200, stock: 25, sortOrder: 507 },
    { sku: 'LIMP-009', name: 'Esponja', presentacion: null, description: 'Esponja lavavajillas 3u', unidadVenta: 'UNIDAD' as const, costPrice: 1500, sellingPrice: 2200, stock: 55, sortOrder: 508 },
    { sku: 'LIMP-010', name: 'Trapo', presentacion: null, description: 'Trapo de piso', unidadVenta: 'UNIDAD' as const, costPrice: 2000, sellingPrice: 3000, stock: 30, sortOrder: 509 },
    { sku: 'LIMP-011', name: 'Escoba', presentacion: null, description: 'Escoba para barrer', unidadVenta: 'UNIDAD' as const, costPrice: 4500, sellingPrice: 6500, stock: 15, sortOrder: 510 },
    { sku: 'LIMP-012', name: 'Recogedor', presentacion: null, description: 'Recogedor para basura', unidadVenta: 'UNIDAD' as const, costPrice: 3000, sellingPrice: 4200, stock: 18, sortOrder: 511 },
    { sku: 'LIMP-013', name: 'Guantes', presentacion: null, description: 'Guantes de limpieza 1u', unidadVenta: 'UNIDAD' as const, costPrice: 2500, sellingPrice: 3500, stock: 40, sortOrder: 512 },
    { sku: 'LIMP-014', name: 'Desinfectante', presentacion: null, description: 'Desinfectante total 1L', unidadVenta: 'VOLUMEN' as const, costPrice: 3500, sellingPrice: 5000, stock: 20, sortOrder: 513 },
    { sku: 'LIMP-015', name: 'Limpiacristales', presentacion: null, description: 'Limpiador de vidrios 500ml', unidadVenta: 'VOLUMEN' as const, costPrice: 4000, sellingPrice: 5500, stock: 22, sortOrder: 514 },
  ];

  for (const p of limpieza) {
    await crearProducto({ ...p, categoryIndex: 5 });
  }

  // ─── ARTÍCULOS DE USO PERSONAL (15) — categoría[6] ────────
  const higiene = [
    { sku: 'HIG-001', name: 'Papel Higiénico', presentacion: null, description: 'Papel higiénico 4 rollos', unidadVenta: 'UNIDAD' as const, costPrice: 3200, sellingPrice: 4500, stock: 45, sortOrder: 600 },
    { sku: 'HIG-002', name: 'Servilleta', presentacion: null, description: 'Servilleta facial 150u', unidadVenta: 'UNIDAD' as const, costPrice: 2500, sellingPrice: 3500, stock: 35, sortOrder: 601 },
    { sku: 'HIG-003', name: 'Jabón Dove', presentacion: null, description: 'Jabón dove 90g', unidadVenta: 'UNIDAD' as const, costPrice: 2800, sellingPrice: 3800, stock: 50, sortOrder: 602 },
    { sku: 'HIG-004', name: 'Shampoo', presentacion: null, description: 'Shampoo 400ml', unidadVenta: 'VOLUMEN' as const, costPrice: 6500, sellingPrice: 8500, stock: 25, sortOrder: 603 },
    { sku: 'HIG-005', name: 'Acondicionador', presentacion: null, description: 'Acondicionador 400ml', unidadVenta: 'VOLUMEN' as const, costPrice: 6000, sellingPrice: 8000, stock: 22, sortOrder: 604 },
    { sku: 'HIG-006', name: 'Crema Dental', presentacion: null, description: 'Crema dental 90ml', unidadVenta: 'UNIDAD' as const, costPrice: 3500, sellingPrice: 4800, stock: 30, sortOrder: 605 },
    { sku: 'HIG-007', name: 'Cepillo Dental', presentacion: null, description: 'Cepillo dental adulto', unidadVenta: 'UNIDAD' as const, costPrice: 2000, sellingPrice: 3000, stock: 40, sortOrder: 606 },
    { sku: 'HIG-008', name: 'Desodorante', presentacion: null, description: 'Desodorante barra 50g', unidadVenta: 'UNIDAD' as const, costPrice: 5500, sellingPrice: 7200, stock: 28, sortOrder: 607 },
    { sku: 'HIG-009', name: 'Desodorante Roll-on', presentacion: null, description: 'Desodorante roll-on 50ml', unidadVenta: 'VOLUMEN' as const, costPrice: 4800, sellingPrice: 6500, stock: 25, sortOrder: 608 },
    { sku: 'HIG-010', name: 'Alcohol Gel', presentacion: null, description: 'Alcohol gel 250ml', unidadVenta: 'VOLUMEN' as const, costPrice: 3500, sellingPrice: 5000, stock: 32, sortOrder: 609 },
    { sku: 'HIG-011', name: 'Toallas Húmedas', presentacion: null, description: 'Toallas húmedas 48u', unidadVenta: 'UNIDAD' as const, costPrice: 4200, sellingPrice: 5800, stock: 28, sortOrder: 610 },
    { sku: 'HIG-012', name: 'Hisopos', presentacion: null, description: 'Hisopos de algodón 100u', unidadVenta: 'UNIDAD' as const, costPrice: 1800, sellingPrice: 2600, stock: 35, sortOrder: 611 },
    { sku: 'HIG-013', name: 'Enjuague Bucal', presentacion: null, description: 'Enjuague bucal 250ml', unidadVenta: 'VOLUMEN' as const, costPrice: 4500, sellingPrice: 6200, stock: 20, sortOrder: 612 },
    { sku: 'HIG-014', name: 'Maquinilla', presentacion: null, description: 'Maquinilla de afeitar 3u', unidadVenta: 'UNIDAD' as const, costPrice: 6000, sellingPrice: 8000, stock: 15, sortOrder: 613 },
    { sku: 'HIG-015', name: 'Talco', presentacion: null, description: 'Talco para pies 200g', unidadVenta: 'UNIDAD' as const, costPrice: 3000, sellingPrice: 4200, stock: 25, sortOrder: 614 },
  ];

  for (const p of higiene) {
    await crearProducto({ ...p, categoryIndex: 6 });
  }

  // ─── GENERAL (10) — categoría[0] ──────────────────────────
  const general = [
    { sku: 'GEN-001', name: 'Cigarrillo', presentacion: null, description: 'Cigarrillo Portland 10u', unidadVenta: 'UNIDAD' as const, costPrice: 5500, sellingPrice: 7000, stock: 50, sortOrder: 700 },
    { sku: 'GEN-002', name: 'Fósforo', presentacion: null, description: 'Caja de fósforos', unidadVenta: 'UNIDAD' as const, costPrice: 400, sellingPrice: 800, stock: 80, sortOrder: 701 },
    { sku: 'GEN-003', name: 'Vela', presentacion: null, description: 'Vela blanca 1u', unidadVenta: 'UNIDAD' as const, costPrice: 1200, sellingPrice: 1800, stock: 30, sortOrder: 702 },
    { sku: 'GEN-004', name: 'Encendedor', presentacion: null, description: 'Encendedor desechable', unidadVenta: 'UNIDAD' as const, costPrice: 500, sellingPrice: 1000, stock: 65, sortOrder: 703 },
    { sku: 'GEN-005', name: 'Bolsa Basura', presentacion: null, description: 'Bolsa de basura 30u', unidadVenta: 'UNIDAD' as const, costPrice: 2200, sellingPrice: 3200, stock: 40, sortOrder: 704 },
    { sku: 'GEN-006', name: 'Pilas', presentacion: null, description: 'Pilas alcalinas AA 4u', unidadVenta: 'UNIDAD' as const, costPrice: 8500, sellingPrice: 11500, stock: 18, sortOrder: 705 },
    { sku: 'GEN-007', name: 'Cargador', presentacion: null, description: 'Cargador celular USB', unidadVenta: 'UNIDAD' as const, costPrice: 12000, sellingPrice: 18000, stock: 8, sortOrder: 706 },
    { sku: 'GEN-008', name: 'Agenda', presentacion: null, description: 'Agenda 2026', unidadVenta: 'UNIDAD' as const, costPrice: 15000, sellingPrice: 22000, stock: 10, sortOrder: 707 },
    { sku: 'GEN-009', name: 'Cuaderno', presentacion: null, description: 'Cuaderno 100 hojas', unidadVenta: 'UNIDAD' as const, costPrice: 2500, sellingPrice: 3500, stock: 45, sortOrder: 708 },
    { sku: 'GEN-010', name: 'Lápiz', presentacion: null, description: 'Lápiz grafito HB', unidadVenta: 'UNIDAD' as const, costPrice: 300, sellingPrice: 600, stock: 120, sortOrder: 709 },
  ];

  for (const p of general) {
    await crearProducto({ ...p, categoryIndex: 0 });
  }

  // ─── PROMOCIONES DE DEMO ──────────────────────────────────
  const lacteosCategory = categories[4];
  const bebidasCategory = categories[3];
  const lecheEntera = await prisma.product.findUnique({ where: { sku: 'LAC-001' } });
  const aguaBotella = await prisma.product.findUnique({ where: { sku: 'BEB-001' } });
  const chocolate = await prisma.product.findUnique({ where: { sku: 'LAC-011' } });
  const ponymal = await prisma.product.findUnique({ where: { sku: 'ABAR-004' } });
  const atun = await prisma.product.findUnique({ where: { sku: 'ABAR-010' } });

  // Promo 1: 20% en Lácteos los viernes
  if (lacteosCategory) {
    await prisma.promotion.upsert({
      where: { id: 'demo-promo-lacteos-viernes' },
      update: {},
      create: {
        id: 'demo-promo-lacteos-viernes',
        storeId: store.id,
        name: '20% en Lácteos los viernes',
        description: 'Descuento del 20% en todos los productos de la categoría Lácteos, válido los viernes.',
        type: 'CATEGORY_PERCENTAGE',
        config: { percent: 20 },
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2027-12-31T23:59:59Z'),
        weekdays: ['FRIDAY'],
        isActive: true,
        priority: 0,
        createdById: adminUser.id,
        items: { create: [{ categoryId: lacteosCategory.id, productId: null }] },
      },
    });
  }

  // Promo 2: 2x1 en Helado Chocolate
  if (chocolate) {
    await prisma.promotion.upsert({
      where: { id: 'demo-promo-helado-2x1' },
      update: {},
      create: {
        id: 'demo-promo-helado-2x1',
        storeId: store.id,
        name: '2x1 en Helado Chocolate',
        description: 'Lleva 2 y paga 1.',
        type: 'N_FOR_FREE',
        config: { buyQuantity: 2, freeQuantity: 1 },
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2027-12-31T23:59:59Z'),
        isActive: true,
        priority: 0,
        createdById: adminUser.id,
        items: { create: [{ productId: chocolate.id, categoryId: null }] },
      },
    });
  }

  // Promo 3: 15% en Agua Botella y Pony Malta
  if (aguaBotella && ponymal) {
    await prisma.promotion.upsert({
      where: { id: 'demo-promo-bebidas-15' },
      update: {},
      create: {
        id: 'demo-promo-bebidas-15',
        storeId: store.id,
        name: '15% en Agua y Pony Malta',
        description: 'Descuento del 15% en productos seleccionados.',
        type: 'PERCENTAGE',
        config: { percent: 15 },
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2027-12-31T23:59:59Z'),
        isActive: true,
        priority: 0,
        createdById: adminUser.id,
        items: {
          create: [
            { productId: aguaBotella.id, categoryId: null },
            { productId: ponymal.id, categoryId: null },
          ],
        },
      },
    });
  }

  // Promo 4: Combo Atún + Pan Francés
  if (atun) {
    const panFrances = await prisma.product.findUnique({ where: { sku: 'ABAR-015' } });
    if (panFrances) {
      await prisma.promotion.upsert({
        where: { id: 'demo-promo-combo-atun' },
        update: {},
        create: {
          id: 'demo-promo-combo-atun',
          storeId: store.id,
          name: 'Combo Atún + Pan Francés',
          description: 'Pack a precio especial.',
          type: 'COMBO',
          config: { comboPrice: 30 },
          startsAt: new Date('2026-01-01T00:00:00Z'),
          endsAt: new Date('2027-12-31T23:59:59Z'),
          isActive: true,
          priority: 0,
          createdById: adminUser.id,
          items: {
            create: [
              { productId: atun.id, categoryId: null, comboPrice: null },
              { productId: panFrances.id, categoryId: null, comboPrice: null },
            ],
          },
        },
      });
    }
  }

  // Promo 5: Volumen — 10% si subtotal ≥ $100,000
  await prisma.promotion.upsert({
    where: { id: 'demo-promo-volumen' },
    update: {},
    create: {
      id: 'demo-promo-volumen',
      storeId: store.id,
      name: '10% si subtotal ≥ $100,000',
      description: 'Descuento automático sobre el subtotal del carrito.',
      type: 'TIERED_BY_AMOUNT',
      config: { tiers: [{ minAmount: 100000, percent: 10 }] },
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: new Date('2027-12-31T23:59:59Z'),
      isActive: true,
      priority: 0,
      createdById: adminUser.id,
      items: { create: [] },
    },
  });

  // Promo 6: $1,000 de descuento directo en Leche Entera
  if (lecheEntera) {
    await prisma.promotion.upsert({
      where: { id: 'demo-promo-leche-directo' },
      update: {},
      create: {
        id: 'demo-promo-leche-directo',
        storeId: store.id,
        name: '$1,000 OFF en Leche Entera',
        description: 'Descuento directo por unidad.',
        type: 'DIRECT_AMOUNT',
        config: { amount: 10 },
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2027-12-31T23:59:59Z'),
        isActive: true,
        priority: 0,
        createdById: adminUser.id,
        items: { create: [{ productId: lecheEntera.id, categoryId: null }] },
      },
    });
  }

  void lacteosCategory;
  void bebidasCategory;

  console.log('Seed completado con 100 productos:');
  console.log(`  Tienda: ${store.name} (${store.code})`);
  console.log(`  Admin: admin@servicaja.com / admin123`);
  console.log(`  Categorías: ${categories.map((c) => c.name).join(', ')}`);
  console.log(`  Lácteos: ${lacteos.length} productos`);
  console.log(`  Bebidas: ${bebidas.length} productos`);
  console.log(`  Alimentos básicos: ${alimentos.length} productos`);
  console.log(`  Abarrotes: ${abarrotes.length} productos`);
  console.log(`  Limpieza: ${limpieza.length} productos`);
  console.log(`  Higiene: ${higiene.length} productos`);
  console.log(`  General: ${general.length} productos`);
  console.log(`  TOTAL: ${lacteos.length + bebidas.length + alimentos.length + abarrotes.length + limpieza.length + higiene.length + general.length} productos`);
  console.log(`  Promociones: 6 demo`);
}

main()
  .catch((e) => {
    console.error(e);
    throw e;
  })
  .finally(() => prisma.$disconnect());
//UPDATE products UPDATE "product" p  SET "costPrice" = "costPrice" / 100