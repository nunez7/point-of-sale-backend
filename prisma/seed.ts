import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const store = await prisma.store.upsert({
    where: { code: 'STORE001' },
    update: {},
    create: { name: 'Tienda Central', code: 'STORE001', address: 'Av. Principal 123' },
  });

  const adminPassword = await bcrypt.hash('admin123', 10);

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
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    throw e;
  })
  .finally(() => prisma.$disconnect());