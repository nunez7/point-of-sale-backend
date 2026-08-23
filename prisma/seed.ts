import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const store = await prisma.store.upsert({
    where: { code: 'STORE001' },
    update: {},
    create: { name: 'Tienda Central', code: 'STORE001', address: 'Av. Principal 123' },
  });

  const adminPassword = await bcrypt.hash('12345678', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@servicaja.com' },
    update: {},
    create: {
      email: 'admin@servicaja.com',
      password: adminPassword,
      name: 'Administrador',
      role: 'ADMIN',
      storeId: store.id,
    },
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

  const categories = [];
  for (const nombre of categoriasBase) {
    const category = await prisma.category.upsert({
      where: { name_storeId: { name: nombre, storeId: store.id } },
      update: {},
      create: { name: nombre, storeId: store.id },
    });
    categories.push(category);
  }
  const category = categories[0];

  const product = await prisma.product.upsert({
    where: { sku: 'PROD-001' },
    update: {},
    create: {
      name: 'Producto de prueba',
      sku: 'PROD-001',
      storeId: store.id,
      categoryId: category.id,
      costPrice: 50,
      sellingPrice: 100,
    },
  });

  await prisma.inventory.upsert({
    where: { storeId_productId: { storeId: store.id, productId: product.id } },
    update: { quantity: 100 },
    create: {
      storeId: store.id,
      productId: product.id,
      quantity: 100,
      lowStockThreshold: 5,
    },
  });

  // Ejemplos de abarrotes: una misma marca con varias presentaciones
  // (cada presentación es su propio registro con SKU y precio) y dos
  // productos a granel vendidos por peso (kg) y volumen (L).
  const productosAbarrotes = [
    {
      sku: 'PROD-CAFE-CH',
      name: 'Café Águila Roja',
      presentacion: 'CH',
      description: 'Presentación chica (100 g)',
      unidadVenta: 'UNIDAD' as const,
      costPrice: 3500,
      sellingPrice: 5500,
      stock: 40,
    },
    {
      sku: 'PROD-CAFE-MD',
      name: 'Café Águila Roja',
      presentacion: 'MD',
      description: 'Presentación mediana (250 g)',
      unidadVenta: 'UNIDAD' as const,
      costPrice: 8000,
      sellingPrice: 12500,
      stock: 30,
    },
    {
      sku: 'PROD-CAFE-GD',
      name: 'Café Águila Roja',
      presentacion: 'GD',
      description: 'Presentación grande (500 g)',
      unidadVenta: 'UNIDAD' as const,
      costPrice: 15000,
      sellingPrice: 23000,
      stock: 20,
    },
    {
      sku: 'PROD-ARROZ-GRANEL',
      name: 'Arroz a granel',
      presentacion: null,
      description: 'Se vende por peso; el precio es por kilogramo',
      unidadVenta: 'PESO' as const,
      costPrice: 3200,
      sellingPrice: 4800,
      stock: 25.5,
    },
    {
      sku: 'PROD-MIEL-GRANEL',
      name: 'Miel pura a granel',
      presentacion: null,
      description: 'Se vende por volumen; el precio es por litro',
      unidadVenta: 'VOLUMEN' as const,
      costPrice: 9000,
      sellingPrice: 14000,
      stock: 10.75,
    },
  ];

  for (const p of productosAbarrotes) {
    const creado = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: {
        name: p.name,
        sku: p.sku,
        description: p.description,
        presentacion: p.presentacion,
        unidadVenta: p.unidadVenta,
        storeId: store.id,
        categoryId: categories[1].id,
        costPrice: p.costPrice,
        sellingPrice: p.sellingPrice,
      },
    });
    await prisma.inventory.upsert({
      where: { storeId_productId: { storeId: store.id, productId: creado.id } },
      update: {},
      create: {
        storeId: store.id,
        productId: creado.id,
        quantity: p.stock,
        lowStockThreshold: 5,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seed completado:');
  // eslint-disable-next-line no-console
  console.log(`  Tienda: ${store.name} (${store.code})`);
  // eslint-disable-next-line no-console
  console.log(`  Admin: ${admin.email} / admin123`);
  // eslint-disable-next-line no-console
  console.log(`  Categorías: ${categories.map((c) => c.name).join(', ')}`);
  // eslint-disable-next-line no-console
  console.log(`  Producto: ${product.name} (stock 100)`);
  // eslint-disable-next-line no-console
  console.log(`  Abarrotes: ${productosAbarrotes.length} productos (presentaciones y granel)`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    throw e;
  })
  .finally(() => prisma.$disconnect());