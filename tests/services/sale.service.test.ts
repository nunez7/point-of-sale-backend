import { afterEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import {
  cajaSessionFixture,
  clienteFixture,
  dec,
  inventoryLotFixture,
  productFixture,
  saleFixture,
  saleItemFixture,
  storeFixture,
} from '../helpers/fixtures';
import type { InventoryLotRow, ProductRow, SaleRow, StoreRow } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import { mexicoEndOfDay, mexicoStartOfDay } from '../../src/utils/dates';
import {
  cancelOrder,
  cancelSale,
  clearHeldSales,
  completeHeldSale,
  confirmOrder,
  createSale,
  deleteHeldSale,
  getSale,
  getSaleBySaleNumber,
  holdSale,
  listHeldSales,
  listOrders,
  listSales,
  retrieveHeldSale,
} from '../../src/services/sale.service';
import type { CreateSaleInput } from '../../src/services/sale.service';

// ───────────────────────────────────────────────────────────────────────────
// Utilidades locales
// ───────────────────────────────────────────────────────────────────────────

const AHORA = new Date('2026-01-15T18:00:00.000Z');

/** Congela el reloj para que las fechas de negocio y los folios sean deterministas. */
function fijarAhora(fecha: Date = AHORA): void {
  vi.useFakeTimers();
  vi.setSystemTime(fecha);
}

afterEach(() => {
  vi.useRealTimers();
});

/** Argumento de la n-ésima llamada a un mock de Prisma. */
function argsDe(mock: { mock: { calls: unknown[][] } }, indice = 0): any {
  return mock.mock.calls[indice]?.[0];
}

function linea(
  over: { productId?: string; quantity?: number; unitPrice?: number } = {}
): { productId: string; quantity: number; unitPrice: number } {
  return {
    productId: over.productId ?? 'product-1',
    quantity: over.quantity ?? 2,
    unitPrice: over.unitPrice ?? 15,
    ...over,
  };
}

function ventaInput(over: Partial<CreateSaleInput> = {}): CreateSaleInput {
  return {
    storeId: 'store-1',
    userId: 'user-1',
    items: [linea()],
    paymentMethod: 'CASH',
    discount: 0,
    ...over,
  };
}

// ── Mocks en cascada de las dependencias (tienda, producto, lotes) ─────────

function prepararTienda(over: Partial<StoreRow> = {}): StoreRow {
  const store = storeFixture({ id: 'store-1', code: 'STORE001', saleSequence: 4, ...over });
  prismaMock.store.findUnique.mockResolvedValue(store);
  return store;
}

function prepararProducto(over: Partial<ProductRow> = {}): ProductRow {
  const producto = productFixture({
    id: 'product-1',
    storeId: 'store-1',
    name: 'Refresco 600ml',
    unidadVenta: 'UNIDAD',
    costPrice: dec('10.00'),
    sellingPrice: dec('15.00'),
    ...over,
  });
  prismaMock.product.findMany.mockResolvedValue([producto]);
  return producto;
}

function prepararInventario(rows: Array<{ productId: string; quantity: unknown }>): void {
  prismaMock.inventory.findMany.mockResolvedValue(rows);
}

function prepararLotes(rows: InventoryLotRow[]): void {
  prismaMock.inventoryLot.findMany.mockResolvedValue(rows);
}

/**
 * Deja configurado el camino feliz de una venta COMPLETED de 2 unidades a
 * $15 con un lote de 10 unidades a costo $10. Cada test sobreescribe lo que
 * necesite (lotes, inventario, promociones…).
 */
function prepararVentaCompletada(): void {
  prepararTienda();
  prepararProducto();
  prepararInventario([{ productId: 'product-1', quantity: dec('10.000') }]);
  prepararLotes([inventoryLotFixture({ id: 'lot-1', unitCost: dec('10.00'), availableQty: dec('10.000') })]);
  prismaMock.store.update.mockResolvedValue({ id: 'store-1', saleSequence: 5 });
  prismaMock.sale.create.mockResolvedValue(
    saleFixture({
      id: 'sale-1',
      saleNumber: 'STORE001-0005',
      total: dec('30.00'),
      subtotal: dec('30.00'),
      profit: dec('10.00'),
      profitMargin: dec('33.33'),
    })
  );
  prismaMock.saleItem.create.mockResolvedValue(saleItemFixture({ id: 'saleitem-1' }));
  prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.inventory.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.saleItemLot.create.mockResolvedValue({ id: 'sil-1' });
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  prismaMock.promotion.findMany.mockResolvedValue([]);
}

/** Promoción tal como la devuelve `tx.promotion.findMany({ include: { items: true } })`. */
function promoFixture(over: Record<string, unknown> = {}) {
  return {
    id: 'promo-1',
    storeId: 'store-1',
    name: 'Descuento de temporada',
    description: null,
    type: 'PERCENTAGE',
    config: { percent: 10 },
    startsAt: new Date('2020-01-01T00:00:00.000Z'),
    endsAt: new Date('2030-01-01T00:00:00.000Z'),
    weekdays: [],
    timeFrom: null,
    timeTo: null,
    isActive: true,
    priority: 1,
    maxUses: null,
    usesCount: 0,
    createdById: 'user-1',
    createdAt: AHORA,
    updatedAt: AHORA,
    items: [{ id: 'promoitem-1', promotionId: 'promo-1', productId: 'product-1', categoryId: null, comboPrice: null }],
    ...over,
  };
}

/** Venta completa (con items y producto) tal como la devuelven las consultas. */
function ventaConItems(over: Record<string, unknown> = {}) {
  return {
    ...saleFixture({ id: 'sale-1', received: dec('50.00'), change: dec('20.00') }),
    items: [
      {
        ...saleItemFixture({ id: 'saleitem-1', originalUnitPrice: dec('18.00') }),
        product: { name: 'Refresco 600ml', presentacion: 'Caja 12 pzas' },
      },
    ],
    user: { id: 'user-1', name: 'Vendedor de Prueba', email: 'vendedor@servicaja.com' },
    ...over,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// createSale
// ───────────────────────────────────────────────────────────────────────────

describe('createSale', () => {
  it('lanza STORE_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => createSale(ventaInput()), {
      status: 404,
      code: 'STORE_NOT_FOUND',
      message: 'Tienda no encontrada',
    });
    expect(prismaMock.sale.create).not.toHaveBeenCalled();
  });

  it('lanza INVALID_DISCOUNT si el descuento es negativo', async () => {
    prepararTienda();

    await expectApiError(() => createSale(ventaInput({ discount: -1 })), {
      status: 400,
      code: 'INVALID_DISCOUNT',
    });
  });

  it('lanza INVALID_DISCOUNT si el descuento supera 100', async () => {
    prepararTienda();

    await expectApiError(() => createSale(ventaInput({ discount: 101 })), {
      status: 400,
      code: 'INVALID_DISCOUNT',
    });
  });

  it('lanza PRODUCT_NOT_FOUND si algún producto no existe o está inactivo', async () => {
    prepararTienda();
    prismaMock.product.findMany.mockResolvedValue([]);

    await expectApiError(() => createSale(ventaInput()), {
      status: 400,
      code: 'PRODUCT_NOT_FOUND',
    });
    expect(prismaMock.sale.create).not.toHaveBeenCalled();
  });

  it('lanza PRODUCT_NOT_FOUND si la respuesta de productos no cubre todas las líneas', async () => {
    prepararTienda();
    const producto = prepararProducto();
    // Dos líneas distintas pero la tienda devuelve el mismo producto dos veces.
    prismaMock.product.findMany.mockResolvedValue([producto, producto]);

    await expectApiError(
      () => createSale(ventaInput({ items: [linea(), linea({ productId: 'product-2' })] })),
      { status: 400, code: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' }
    );
  });

  it('lanza INVALID_QUANTITY si un producto por unidad lleva cantidad decimal', async () => {
    prepararTienda();
    prepararProducto();

    await expectApiError(() => createSale(ventaInput({ items: [linea({ quantity: 1.5 })] })), {
      status: 400,
      code: 'INVALID_QUANTITY',
      message: /se vende por unidad/,
    });
  });

  it('lanza INVALID_PRICE si el precio unitario no es positivo', async () => {
    prepararTienda();
    prepararProducto();

    await expectApiError(() => createSale(ventaInput({ items: [linea({ unitPrice: 0 })] })), {
      status: 400,
      code: 'INVALID_PRICE',
    });
  });

  it('registra una venta COMPLETED en efectivo con recibido, cambio y folio correlativo', async () => {
    prepararVentaCompletada();

    const resultado = await createSale(ventaInput({ received: 50, change: 20 }));

    const data = argsDe(prismaMock.sale.create).data;
    expect(data.saleNumber).toBe('STORE001-0005');
    expect(data.status).toBe('COMPLETED');
    expect(data.paymentMethod).toBe('CASH');
    expect(Number(data.subtotal)).toBe(30);
    expect(Number(data.discount)).toBe(0);
    expect(Number(data.total)).toBe(30);
    expect(Number(data.profit)).toBe(10);
    expect(data.received.toString()).toBe('50');
    expect(data.change.toString()).toBe('20');
    expect(data.clienteId).toBeUndefined();
    expect(data.notes).toBeUndefined();
    expect(data.cajaSessionId).toBeUndefined();

    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { saleSequence: { increment: 1 } },
    });

    const item = argsDe(prismaMock.saleItem.create).data;
    expect(item).toMatchObject({ productId: 'product-1', unidad: 'u', saleId: 'sale-1' });
    expect(Number(item.quantity)).toBe(2);
    expect(Number(item.unitPrice)).toBe(15);
    expect(Number(item.costPrice)).toBe(10);
    expect(Number(item.profit)).toBe(10);
    expect(item.originalUnitPrice).toBeNull();

    // Inventario y lote descontados de forma atómica.
    expect(prismaMock.inventory.updateMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', productId: 'product-1', quantity: { gte: expect.anything() } },
      data: { quantity: { decrement: expect.anything() } },
    });
    expect(prismaMock.saleItemLot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ saleItemId: 'saleitem-1', lotId: 'lot-1' }),
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'SALE',
        entity: 'SALE',
        entityId: 'sale-1',
        metadata: expect.objectContaining({ saleNumber: 'STORE001-0005', status: 'COMPLETED', items: 1 }),
      }),
    });

    expect(resultado).toEqual({
      id: 'sale-1',
      saleNumber: 'STORE001-0005',
      total: 30,
      profit: 10,
      profitMargin: 33.33,
      status: 'COMPLETED',
    });
  });

  it('genera el folio con ceros a la izquierda según la secuencia de la tienda', async () => {
    prepararVentaCompletada();
    prismaMock.store.update.mockResolvedValue({ id: 'store-1', saleSequence: 7 });
    prismaMock.sale.create.mockResolvedValue(
      saleFixture({ id: 'sale-7', saleNumber: 'STORE001-0007', profitMargin: dec('33.33') })
    );

    const resultado = await createSale(ventaInput());

    expect(resultado.saleNumber).toBe('STORE001-0007');
    expect(argsDe(prismaMock.sale.create).data.saleNumber).toBe('STORE001-0007');
  });

  it('usa el costo promedio ponderado de los lotes FEFO de varios lotes', async () => {
    prepararVentaCompletada();
    prepararInventario([{ productId: 'product-1', quantity: dec('6.000') }]);
    prepararLotes([
      inventoryLotFixture({
        id: 'lot-viejo',
        expirationDate: new Date('2026-02-01T00:00:00.000Z'),
        availableQty: dec('1.000'),
        unitCost: dec('10.00'),
      }),
      inventoryLotFixture({
        id: 'lot-nuevo',
        expirationDate: new Date('2026-03-01T00:00:00.000Z'),
        availableQty: dec('5.000'),
        unitCost: dec('12.00'),
      }),
    ]);

    const resultado = await createSale(ventaInput({ items: [linea({ quantity: 3 })] }));

    // 1 unidad del lote viejo ($10) + 2 del nuevo ($12) = $34 / 3 = $11.33
    const item = argsDe(prismaMock.saleItem.create).data;
    expect(Number(item.costPrice)).toBe(11.33);
    expect(Number(item.profit)).toBe(11.01);
    expect(resultado.profit).toBe(11.01);

    const asignaciones = prismaMock.saleItemLot.create.mock.calls.map((c) => (c[0] as any).data);
    expect(asignaciones).toHaveLength(2);
    expect(asignaciones[0]).toMatchObject({ lotId: 'lot-viejo', unitCost: expect.anything() });
    expect(Number(asignaciones[0].quantity)).toBe(1);
    expect(asignaciones[1]).toMatchObject({ lotId: 'lot-nuevo' });
    expect(Number(asignaciones[1].quantity)).toBe(2);

    // El lote surtidor queda con su availableQty decrementado y su status revisado.
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenCalledTimes(4);
  });

  it('etiqueta los productos a granel como kg y L', async () => {
    prepararVentaCompletada();
    const peso = productFixture({
      id: 'product-1',
      name: 'Manzana roja',
      unidadVenta: 'PESO',
      costPrice: dec('10.00'),
    });
    const volumen = productFixture({
      id: 'product-2',
      name: 'Leche a granel',
      unidadVenta: 'VOLUMEN',
      costPrice: dec('12.00'),
    });
    prismaMock.product.findMany.mockResolvedValue([peso, volumen]);
    prepararInventario([
      { productId: 'product-1', quantity: dec('10.000') },
      { productId: 'product-2', quantity: dec('10.000') },
    ]);
    prepararLotes([
      inventoryLotFixture({ id: 'lot-1', productId: 'product-1', availableQty: dec('10.000') }),
      inventoryLotFixture({ id: 'lot-2', productId: 'product-2', availableQty: dec('10.000'), unitCost: dec('12.00') }),
    ]);

    const resultado = await createSale(
      ventaInput({
        items: [linea({ productId: 'product-1', quantity: 0.5, unitPrice: 20 }), linea({ productId: 'product-2', quantity: 1.25, unitPrice: 25 })],
      })
    );

    const items = prismaMock.saleItem.create.mock.calls.map((c) => (c[0] as any).data);
    expect(items[0].unidad).toBe('kg');
    expect(Number(items[0].quantity)).toBe(0.5);
    expect(items[1].unidad).toBe('L');
    expect(Number(items[1].quantity)).toBe(1.25);
    expect(Number(argsDe(prismaMock.sale.create).data.total)).toBe(41.25);
    expect(resultado.total).toBe(41.25);
  });

  it.each(['CARD', 'TRANSFER', 'CREDIT', 'OTHER'])(
    'registra el pago con %s sin montos de efectivo',
    async (metodo) => {
      prepararVentaCompletada();

      await createSale(ventaInput({ paymentMethod: metodo, received: 100, change: 70 }));

      const data = argsDe(prismaMock.sale.create).data;
      expect(data.paymentMethod).toBe(metodo);
      expect(data.received).toBeUndefined();
      expect(data.change).toBeUndefined();
    }
  );

  it('prorratea el descuento global entre las líneas para calcular la utilidad', async () => {
    prepararVentaCompletada();
    const refresco = productFixture({ id: 'product-1', costPrice: dec('10.00') });
    const botana = productFixture({ id: 'product-2', name: 'Botana', costPrice: dec('12.00') });
    prismaMock.product.findMany.mockResolvedValue([refresco, botana]);
    prepararInventario([
      { productId: 'product-1', quantity: dec('10.000') },
      { productId: 'product-2', quantity: dec('10.000') },
    ]);
    prepararLotes([
      inventoryLotFixture({ id: 'lot-1', productId: 'product-1', availableQty: dec('10.000') }),
      inventoryLotFixture({ id: 'lot-2', productId: 'product-2', availableQty: dec('10.000'), unitCost: dec('12.00') }),
    ]);

    const resultado = await createSale(
      ventaInput({
        discount: 10,
        items: [linea({ quantity: 2, unitPrice: 15 }), linea({ productId: 'product-2', quantity: 1, unitPrice: 20 })],
      })
    );

    const data = argsDe(prismaMock.sale.create).data;
    expect(Number(data.subtotal)).toBe(50);
    expect(Number(data.discount)).toBe(10);
    expect(Number(data.total)).toBe(40);
    // Línea A: 30 - 6 (prorrateo) - 20 (costo) = 4; línea B: 20 - 4 - 12 = 4
    expect(Number(data.profit)).toBe(8);
    expect(resultado.profit).toBe(8);
    expect(resultado.total).toBe(40);
  });

  it('limita el descuento al subtotal para no generar totales negativos', async () => {
    prepararVentaCompletada();
    prismaMock.sale.create.mockResolvedValue(
      saleFixture({ id: 'sale-1', total: dec('0.00'), profit: dec('-10.00'), profitMargin: dec('0.00') })
    );

    const resultado = await createSale(ventaInput({ discount: 100, items: [linea({ quantity: 1 })] }));

    const data = argsDe(prismaMock.sale.create).data;
    expect(Number(data.discount)).toBe(15);
    expect(Number(data.total)).toBe(0);
    expect(Number(data.profit)).toBe(-10);
    expect(Number(data.profitMargin)).toBe(0);
    expect(resultado.total).toBe(0);
    expect(resultado.profitMargin).toBe(0);
  });

  it('registra cliente, notas y sesión de caja enviados', async () => {
    prepararVentaCompletada();

    await createSale(
      ventaInput({
        clienteId: 'cliente-1',
        notes: 'Entregar por la tarde',
        cajaSessionId: 'cajasession-1',
        discount: 5,
      })
    );

    const data = argsDe(prismaMock.sale.create).data;
    expect(data.clienteId).toBe('cliente-1');
    expect(data.notes).toBe('Entregar por la tarde');
    expect(data.cajaSessionId).toBe('cajasession-1');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ clienteId: 'cliente-1' }),
      }),
    });
  });

  it('crea un pedido PENDING sin descontar inventario ni consumir lotes', async () => {
    prepararVentaCompletada();

    const resultado = await createSale(ventaInput({ status: 'PENDING' }));

    const data = argsDe(prismaMock.sale.create).data;
    expect(data.status).toBe('PENDING');
    expect(Number(argsDe(prismaMock.saleItem.create).data.costPrice)).toBe(10);
    expect(prismaMock.inventoryLot.findMany).not.toHaveBeenCalled();
    expect(prismaMock.saleItemLot.create).not.toHaveBeenCalled();
    expect(prismaMock.inventory.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'CREATE_ORDER', metadata: expect.objectContaining({ status: 'PENDING' }) }),
    });
    expect(resultado.status).toBe('PENDING');
  });

  it('lanza INSUFFICIENT_STOCK al crear un pedido sin existencias registradas', async () => {
    prepararVentaCompletada();
    prepararInventario([]);

    await expectApiError(() => createSale(ventaInput({ status: 'PENDING' })), {
      status: 400,
      code: 'INSUFFICIENT_STOCK',
      message: /Stock insuficiente para "Refresco 600ml" \(disponible: 0\)/,
    });
  });

  it('lanza INSUFFICIENT_STOCK cuando el pedido excede el stock disponible', async () => {
    prepararVentaCompletada();
    prepararInventario([{ productId: 'product-1', quantity: dec('1.000') }]);

    await expectApiError(() => createSale(ventaInput({ status: 'PENDING' })), {
      status: 400,
      code: 'INSUFFICIENT_STOCK',
      message: /disponible: 1/,
    });
  });

  it('usa el id del producto en el mensaje cuando la fila no trae nombre', async () => {
    prepararVentaCompletada();
    prismaMock.product.findMany.mockResolvedValue([
      { ...productFixture({ id: 'product-1', name: 'Refresco 600ml' }), name: undefined },
    ]);
    prepararInventario([]);

    await expectApiError(() => createSale(ventaInput({ status: 'PENDING' })), {
      status: 400,
      code: 'INSUFFICIENT_STOCK',
      message: /"product-1"/,
    });
  });

  it('lanza INSUFFICIENT_STOCK cuando los lotes no cubren la venta', async () => {
    prepararVentaCompletada();
    // Inventario y lote cuadrados en 1 unidad: no hay autocorrección de lotes.
    prepararInventario([{ productId: 'product-1', quantity: dec('1.000') }]);
    prepararLotes([inventoryLotFixture({ id: 'lot-1', availableQty: dec('1.000') })]);

    await expectApiError(() => createSale(ventaInput({ items: [linea({ quantity: 2 })] })), {
      status: 400,
      code: 'INSUFFICIENT_STOCK',
      message: /faltan 1/,
    });
    expect(prismaMock.sale.create).not.toHaveBeenCalled();
  });

  it('lanza INSUFFICIENT_STOCK si el inventario cambia al descontarlo', async () => {
    prepararVentaCompletada();
    prismaMock.inventory.updateMany.mockResolvedValue({ count: 0 });

    await expectApiError(() => createSale(ventaInput()), {
      status: 400,
      code: 'INSUFFICIENT_STOCK',
      message: 'Stock insuficiente al deducir inventario',
    });
  });

  it('crea un lote de ajuste cuando el inventario no está respaldado por lotes', async () => {
    prepararVentaCompletada();
    prepararLotes([]);
    prismaMock.product.findUnique.mockResolvedValue({ name: 'Refresco 600ml', costPrice: dec('10.00') });
    prismaMock.inventoryLot.create.mockResolvedValue(
      inventoryLotFixture({ id: 'lot-ajuste', lotCode: 'AJUSTE', availableQty: dec('10.000') })
    );

    await createSale(ventaInput());

    expect(prismaMock.inventoryLot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: 'product-1', lotCode: 'AJUSTE' }),
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.auditLog.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ action: 'LOTE_AJUSTE' }),
    });
    expect(prismaMock.saleItemLot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ lotId: 'lot-ajuste' }),
    });
  });

  it('exige una sesión de caja abierta cuando la tienda controla cajas', async () => {
    prepararTienda({ controlCajas: true });
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expectApiError(() => createSale(ventaInput()), {
      status: 400,
      code: 'CAJA_SESSION_REQUIRED',
    });
  });

  it('lanza CAJA_SESSION_INVALID si la sesión enviada no está abierta', async () => {
    prepararTienda({ controlCajas: true });
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expectApiError(() => createSale(ventaInput({ cajaSessionId: 'cajasession-9' })), {
      status: 400,
      code: 'CAJA_SESSION_INVALID',
    });
    expect(prismaMock.cajaSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'cajasession-9', storeId: 'store-1', status: 'OPEN' },
    });
  });

  it('valida la sesión de caja enviada y la guarda en la venta', async () => {
    prepararVentaCompletada();
    prepararTienda({ controlCajas: true });
    prismaMock.cajaSession.findFirst.mockResolvedValue(cajaSessionFixture({ id: 'cajasession-9' }));

    await createSale(ventaInput({ cajaSessionId: 'cajasession-9' }));

    expect(argsDe(prismaMock.sale.create).data.cajaSessionId).toBe('cajasession-9');
  });

  it('resuelve la sesión abierta del usuario cuando no se envía el id', async () => {
    prepararVentaCompletada();
    prepararTienda({ controlCajas: true });
    prismaMock.cajaSession.findFirst.mockResolvedValue(cajaSessionFixture({ id: 'cajasession-3' }));

    await createSale(ventaInput());

    expect(argsDe(prismaMock.sale.create).data.cajaSessionId).toBe('cajasession-3');
  });

  it('aplica una promoción porcentual y guarda el precio original de la línea', async () => {
    prepararVentaCompletada();
    prismaMock.promotion.findMany.mockResolvedValue([promoFixture()]);
    prismaMock.promotion.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.promotionApplication.create.mockResolvedValue({ id: 'app-1' });

    const resultado = await createSale(ventaInput());

    const item = argsDe(prismaMock.saleItem.create).data;
    expect(Number(item.unitPrice)).toBe(13.5);
    expect(Number(item.originalUnitPrice)).toBe(15);
    expect(Number(item.profit)).toBe(7);

    const data = argsDe(prismaMock.sale.create).data;
    expect(Number(data.total)).toBe(27);
    // El ahorro de la promoción se reporta dentro del descuento de la venta.
    expect(Number(data.discount)).toBe(3);
    expect(resultado.total).toBe(27);

    expect(prismaMock.promotion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { usesCount: { increment: 1 } } })
    );
    expect(prismaMock.promotionApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ promotionId: 'promo-1', saleId: 'sale-1', savedAmount: 3 }),
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ promotions: 1, savedByPromos: '3' }),
      }),
    });
  });

  it('registra promociones por volumen sin cambiar el precio de línea', async () => {
    prepararVentaCompletada();
    prismaMock.promotion.findMany.mockResolvedValue([
      promoFixture({
        type: 'TIERED_BY_AMOUNT',
        config: { tiers: [{ minAmount: 0, percent: 10 }] },
        items: [],
      }),
    ]);
    prismaMock.promotion.updateMany.mockResolvedValue({ count: 1 });

    await createSale(ventaInput());

    const item = argsDe(prismaMock.saleItem.create).data;
    expect(Number(item.unitPrice)).toBe(15);
    expect(item.originalUnitPrice).toBeNull();
    expect(prismaMock.promotionApplication.create).toHaveBeenCalledTimes(1);
  });

  it('propaga PROMOTION_MAX_USES cuando la promoción agotó sus usos', async () => {
    prepararVentaCompletada();
    prismaMock.promotion.findMany.mockResolvedValue([promoFixture()]);
    prismaMock.promotion.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.promotion.findUnique.mockResolvedValue({ id: 'promo-1', name: 'Descuento', maxUses: 5, usesCount: 5 });

    await expectApiError(() => createSale(ventaInput()), {
      status: 400,
      code: 'PROMOTION_MAX_USES',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// listSales
// ───────────────────────────────────────────────────────────────────────────

describe('listSales', () => {
  it('lista solo las ventas completadas de la tienda', async () => {
    prismaMock.sale.findMany.mockResolvedValue([ventaConItems()]);

    const resultado = await listSales({ storeId: 'store-1' });

    expect(argsDe(prismaMock.sale.findMany)).toEqual({
      where: { status: 'COMPLETED', storeId: 'store-1' },
      include: {
        items: { include: { product: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(resultado).toHaveLength(1);
  });

  it('serializa montos y líneas al borde del servicio', async () => {
    prismaMock.sale.findMany.mockResolvedValue([ventaConItems()]);

    const [venta] = await listSales({});

    expect(venta.total).toBe(100);
    expect(venta.subtotal).toBe(100);
    expect(venta.discount).toBe(0);
    expect(venta.profit).toBe(30);
    expect(venta.profitMargin).toBe(30);
    expect(venta.received).toBe(50);
    expect(venta.change).toBe(20);
    expect(venta.items[0]).toMatchObject({
      quantity: 2,
      unitPrice: 15,
      originalUnitPrice: 18,
      costPrice: 10,
      profit: 10,
      productName: 'Refresco 600ml',
      productPresentacion: 'Caja 12 pzas',
    });
  });

  it('usa el productName de la línea cuando la consulta no incluye el producto', async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      {
        ...saleFixture({ id: 'sale-9', received: null, change: null }),
        items: [
          {
            ...saleItemFixture({ id: 'saleitem-9', originalUnitPrice: null }),
            productName: 'Producto libre',
          },
        ],
        user: { id: 'user-1', name: 'Vendedor de Prueba', email: 'vendedor@servicaja.com' },
      },
    ]);

    const [venta] = await listSales({ storeId: 'store-1' });

    expect(venta.received).toBeNull();
    expect(venta.change).toBeNull();
    expect(venta.items[0].originalUnitPrice).toBeNull();
    expect(venta.items[0].productName).toBe('Producto libre');
    expect(venta.items[0].productPresentacion).toBeNull();
  });

  it('filtra por rango de fechas del día de negocio', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    const resultado = await listSales({ storeId: 'store-1', startDate: '2026-01-10', endDate: '2026-01-20' });

    expect(argsDe(prismaMock.sale.findMany).where).toEqual({
      status: 'COMPLETED',
      storeId: 'store-1',
      createdAt: { gte: mexicoStartOfDay('2026-01-10'), lte: mexicoEndOfDay('2026-01-20') },
    });
    expect(resultado).toEqual([]);
  });

  it('filtra solo con fecha inicial', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await listSales({ startDate: '2026-01-10' });

    expect(argsDe(prismaMock.sale.findMany).where).toEqual({
      status: 'COMPLETED',
      createdAt: { gte: mexicoStartOfDay('2026-01-10') },
    });
    expect(argsDe(prismaMock.sale.findMany).where).not.toHaveProperty('storeId');
  });

  it('filtra solo con fecha final', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await listSales({ endDate: '2026-01-20' });

    expect(argsDe(prismaMock.sale.findMany).where).toEqual({
      status: 'COMPLETED',
      createdAt: { lte: mexicoEndOfDay('2026-01-20') },
    });
  });

  it('no filtra por tienda cuando no se envía storeId', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await listSales({});

    expect(argsDe(prismaMock.sale.findMany).where).toEqual({ status: 'COMPLETED' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getSale
// ───────────────────────────────────────────────────────────────────────────

describe('getSale', () => {
  it('devuelve la venta serializada de la tienda', async () => {
    prismaMock.sale.findFirst.mockResolvedValue({
      ...ventaConItems(),
      items: [
        {
          ...saleItemFixture({ id: 'saleitem-1', originalUnitPrice: dec('18.00') }),
          product: { name: 'Refresco 600ml', presentacion: null, category: { id: 'category-1' } },
        },
      ],
    });

    const venta = await getSale('sale-1', 'store-1');

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith({
      where: { id: 'sale-1', storeId: 'store-1' },
      include: {
        items: { include: { product: { include: { category: true } } } },
        user: { select: { id: true, name: true, email: true } },
      },
    });
    expect(venta).not.toBeNull();
    expect(venta!.id).toBe('sale-1');
    expect(venta!.total).toBe(100);
    expect(venta!.items[0]).toMatchObject({
      quantity: 2,
      unitPrice: 15,
      originalUnitPrice: 18,
      productName: 'Refresco 600ml',
      productPresentacion: null,
    });
  });

  it('devuelve null cuando la venta no existe o es de otra tienda', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expect(getSale('sale-x', 'store-2')).resolves.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getSaleBySaleNumber
// ───────────────────────────────────────────────────────────────────────────

describe('getSaleBySaleNumber', () => {
  it('busca el folio solo entre las ventas completadas de la tienda', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(ventaConItems());

    const venta = await getSaleBySaleNumber('store-1', 'STORE001-0001');

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith({
      where: { saleNumber: 'STORE001-0001', storeId: 'store-1', status: 'COMPLETED' },
      include: { items: { include: { product: { include: { category: true } } } } },
    });
    expect(venta).not.toBeNull();
    expect(venta!.total).toBe(100);
  });

  it('devuelve null si el folio no existe en la tienda', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expect(getSaleBySaleNumber('store-1', 'STORE001-9999')).resolves.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// cancelSale
// ───────────────────────────────────────────────────────────────────────────

/** Línea de venta con las asignaciones de lote que espera `cancelSale`. */
function itemCancelable(over: Record<string, unknown> = {}) {
  return {
    ...saleItemFixture({ id: 'saleitem-1', quantity: dec('2.000') }),
    lotAssignments: [
      {
        id: 'sil-1',
        saleItemId: 'saleitem-1',
        lotId: 'lot-1',
        quantity: dec('2.000'),
        restoredQty: dec('0.000'),
        unitCost: dec('10.00'),
      },
    ],
    ...over,
  };
}

/** Venta que devuelve el `findFirst` de `cancelSale`. */
function ventaCancelable(over: Record<string, unknown> = {}) {
  return {
    ...saleFixture({ id: 'sale-1', saleNumber: 'STORE001-0001', total: dec('30.00') }),
    items: [itemCancelable()],
    factura: null as { id: string; status: string } | null,
    ...over,
  };
}

function prepararCancelacion(): void {
  prismaMock.sale.findFirst.mockResolvedValue(ventaCancelable());
  prismaMock.inventory.findMany.mockResolvedValue([{ productId: 'product-1' }]);
  prismaMock.inventory.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.saleItemLot.update.mockResolvedValue({ id: 'sil-1' });
  prismaMock.promotionApplication.findMany.mockResolvedValue([]);
  prismaMock.promotion.update.mockResolvedValue({ id: 'promo-1' });
  prismaMock.promotionApplication.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.sale.update.mockResolvedValue(saleFixture({ id: 'sale-1', status: 'CANCELED' }));
  prismaMock.cancellation.create.mockResolvedValue({ id: 'cancellation-1' });
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
}

describe('cancelSale', () => {
  it('lanza SALE_NOT_FOUND si la venta no existe o ya está cancelada', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expectApiError(() => cancelSale('sale-x', 'store-1', 'user-1'), {
      status: 404,
      code: 'SALE_NOT_FOUND',
      message: 'Venta no encontrada o ya cancelada',
    });
    expect(prismaMock.sale.update).not.toHaveBeenCalled();
  });

  it('lanza SALE_HAS_ACTIVE_INVOICE si la venta tiene factura emitida', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(
      ventaCancelable({ factura: { id: 'factura-1', status: 'EMITIDA' } })
    );

    await expectApiError(() => cancelSale('sale-1', 'store-1', 'user-1'), {
      status: 400,
      code: 'SALE_HAS_ACTIVE_INVOICE',
    });
    expect(prismaMock.sale.update).not.toHaveBeenCalled();
  });

  it('permite cancelar cuando la factura ya fue cancelada', async () => {
    prepararCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(
      ventaCancelable({ factura: { id: 'factura-1', status: 'CANCELED' } })
    );

    await cancelSale('sale-1', 'store-1', 'user-1');

    expect(prismaMock.sale.update).toHaveBeenCalled();
  });

  it('cancela la venta, restaura inventario y lotes, y audita sin motivo', async () => {
    prepararCancelacion();
    fijarAhora();

    const cancelada = await cancelSale('sale-1', 'store-1', 'user-9');

    expect(prismaMock.inventory.updateMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', productId: 'product-1' },
      data: { quantity: { increment: expect.anything() } },
    });
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenCalledWith({
      where: { id: 'lot-1' },
      data: { availableQty: { increment: expect.anything() }, status: 'ACTIVE' },
    });
    expect(prismaMock.saleItemLot.update).toHaveBeenCalledWith({
      where: { id: 'sil-1' },
      data: { restoredQty: { increment: expect.anything() } },
    });

    const data = argsDe(prismaMock.sale.update).data;
    expect(data.status).toBe('CANCELED');
    expect(data.canceledAt).toEqual(AHORA);
    expect(data.canceledBy).toBe('user-9');
    expect(data).not.toHaveProperty('cancellationReasonId');
    expect(data).not.toHaveProperty('cancellationComment');

    expect(prismaMock.cancellation.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CANCEL_SALE',
        entity: 'SALE',
        entityId: 'sale-1',
        metadata: { saleNumber: 'STORE001-0001' },
      }),
    });
    expect(cancelada.status).toBe('CANCELED');
  });

  it('registra la cancelación con motivo y comentario', async () => {
    prepararCancelacion();

    await cancelSale('sale-1', 'store-1', 'user-1', 'reason-1', 'Cliente devolvió la mercancía');

    const data = argsDe(prismaMock.sale.update).data;
    expect(data.cancellationReasonId).toBe('reason-1');
    expect(data.cancellationComment).toBe('Cliente devolvió la mercancía');

    expect(prismaMock.cancellation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        userId: 'user-1',
        entityType: 'SALE',
        entityId: 'sale-1',
        entityNumber: 'STORE001-0001',
        type: 'FULL',
        cancellationReasonId: 'reason-1',
        comment: 'Cliente devolvió la mercancía',
      }),
    });
    expect(argsDe(prismaMock.auditLog.create).data.metadata).toEqual({
      saleNumber: 'STORE001-0001',
      cancellationReasonId: 'reason-1',
      comment: 'Cliente devolvió la mercancía',
    });
  });

  it('guarda el comentario nulo cuando se envía null', async () => {
    prepararCancelacion();

    await cancelSale('sale-1', 'store-1', 'user-1', 'reason-1', null);

    expect(argsDe(prismaMock.sale.update).data.cancellationComment).toBeNull();
    expect(argsDe(prismaMock.cancellation.create).data.comment).toBeNull();
    expect(argsDe(prismaMock.auditLog.create).data.metadata).toEqual({
      saleNumber: 'STORE001-0001',
      cancellationReasonId: 'reason-1',
    });
  });

  it('no restaura mercancía ya devuelta en cancelaciones parciales previas', async () => {
    prepararCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(
      ventaCancelable({
        items: [
          itemCancelable({
            lotAssignments: [
              {
                id: 'sil-1',
                saleItemId: 'saleitem-1',
                lotId: 'lot-1',
                quantity: dec('2.000'),
                restoredQty: dec('2.000'),
                unitCost: dec('10.00'),
              },
            ],
          }),
        ],
      })
    );

    await cancelSale('sale-1', 'store-1', 'user-1');

    expect(prismaMock.inventory.findMany).not.toHaveBeenCalled();
    expect(prismaMock.inventory.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.saleItemLot.update).not.toHaveBeenCalled();
    expect(prismaMock.sale.update).toHaveBeenCalled();
  });

  it('devuelve el remanente de una línea parcialmente devuelta a un lote genérico', async () => {
    prepararCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(
      ventaCancelable({
        items: [itemCancelable({ quantity: dec('3.000') })],
      })
    );
    prismaMock.inventoryLot.findFirst.mockResolvedValue(
      inventoryLotFixture({ id: 'lot-generico', productId: 'product-1' })
    );
    prismaMock.inventoryLot.update.mockResolvedValue({ id: 'lot-generico' });

    await cancelSale('sale-1', 'store-1', 'user-1');

    // Se devuelven 2 al lote original y 1 al lote más reciente del producto.
    expect(prismaMock.saleItemLot.update).toHaveBeenCalledWith({
      where: { id: 'sil-1' },
      data: { restoredQty: { increment: expect.anything() } },
    });
    expect(prismaMock.inventoryLot.update).toHaveBeenCalledWith({
      where: { id: 'lot-generico' },
      data: { availableQty: { increment: expect.anything() }, status: 'ACTIVE' },
    });
  });

  it('crea un lote de devolución cuando el producto no tiene inventario ni lotes', async () => {
    prepararCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(
      ventaCancelable({ items: [itemCancelable({ lotAssignments: [] })] })
    );
    prismaMock.inventory.findMany.mockResolvedValue([]);
    prismaMock.inventory.createMany.mockResolvedValue({ count: 1 });
    prismaMock.inventoryLot.findFirst.mockResolvedValue(null);
    prismaMock.product.findUnique.mockResolvedValue({ costPrice: dec('10.00') });
    prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-devolucion' }));

    await cancelSale('sale-1', 'store-1', 'user-1');

    expect(prismaMock.inventory.createMany).toHaveBeenCalledWith({
      data: [{ storeId: 'store-1', productId: 'product-1', quantity: expect.anything() }],
    });
    expect(prismaMock.inventoryLot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: 'product-1', lotCode: 'DEVOLUCION' }),
    });
  });

  it('revierte las promociones aplicadas a la venta cancelada', async () => {
    prepararCancelacion();
    prismaMock.promotionApplication.findMany.mockResolvedValue([
      { id: 'app-1', saleId: 'sale-1', promotionId: 'promo-1' },
      { id: 'app-2', saleId: 'sale-1', promotionId: 'promo-2' },
    ]);

    await cancelSale('sale-1', 'store-1', 'user-1');

    expect(prismaMock.promotion.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.promotion.update).toHaveBeenCalledWith({
      where: { id: 'promo-1' },
      data: { usesCount: { decrement: 1 } },
    });
    expect(prismaMock.promotionApplication.deleteMany).toHaveBeenCalledWith({
      where: { saleId: 'sale-1' },
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// confirmOrder
// ───────────────────────────────────────────────────────────────────────────

/** Pedido pendiente con sus líneas, tal como lo devuelve `confirmOrder`. */
function pedidoPendiente(over: Record<string, unknown> = {}) {
  return {
    ...saleFixture({
      id: 'sale-1',
      saleNumber: 'STORE001-0001',
      status: 'PENDING',
      total: dec('30.00'),
      profit: dec('10.00'),
    }),
    items: [
      {
        id: 'saleitem-1',
        saleId: 'sale-1',
        productId: 'product-1',
        quantity: dec('2.000'),
        unidad: 'u',
        unitPrice: dec('15.00'),
        costPrice: dec('10.00'),
        profit: dec('10.00'),
      },
    ],
    ...over,
  };
}

function prepararConfirmacion(costoLote: string): void {
  prismaMock.sale.findFirst.mockResolvedValue(pedidoPendiente());
  prismaMock.inventory.findMany.mockResolvedValue([{ productId: 'product-1', quantity: dec('10.000') }]);
  prismaMock.inventoryLot.findMany.mockResolvedValue([
    inventoryLotFixture({ id: 'lot-1', productId: 'product-1', availableQty: dec('10.000'), unitCost: dec(costoLote) }),
  ]);
  prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.saleItem.update.mockResolvedValue({ id: 'saleitem-1' });
  prismaMock.saleItemLot.create.mockResolvedValue({ id: 'sil-1' });
  prismaMock.inventory.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.sale.update.mockResolvedValue(saleFixture({ id: 'sale-1', status: 'COMPLETED' }));
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
}

describe('confirmOrder', () => {
  it('lanza ORDER_NOT_FOUND si el pedido no existe o ya fue confirmado', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expectApiError(() => confirmOrder('sale-x', 'store-1', 'user-1'), {
      status: 404,
      code: 'ORDER_NOT_FOUND',
      message: 'Pedido no encontrado o ya confirmado',
    });
    expect(prismaMock.sale.update).not.toHaveBeenCalled();
  });

  it('confirma el pedido, consume lotes FEFO y descuenta inventario', async () => {
    prepararConfirmacion('12.00');
    fijarAhora();

    const confirmada = await confirmOrder('sale-1', 'store-1', 'user-9');

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith({
      where: { id: 'sale-1', storeId: 'store-1', status: 'PENDING' },
      include: { items: true },
    });

    // El costo real del lote corrige el costo de la línea y su utilidad.
    const item = argsDe(prismaMock.saleItem.update).data;
    expect(Number(item.costPrice)).toBe(12);
    expect(Number(item.profit)).toBe(6);
    expect(prismaMock.saleItemLot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ saleItemId: 'saleitem-1', lotId: 'lot-1' }),
    });

    // Primero el ajuste de utilidad (10 - 4 de sobrecosto), después el cambio de estado.
    const ajuste = argsDe(prismaMock.sale.update, 0).data;
    expect(Number(ajuste.profit)).toBe(6);
    expect(Number(ajuste.profitMargin)).toBeCloseTo(20, 3);

    const estado = argsDe(prismaMock.sale.update, 1).data;
    expect(estado).toMatchObject({ status: 'COMPLETED', confirmedBy: 'user-9' });
    expect(estado.confirmedAt).toEqual(AHORA);

    expect(prismaMock.inventory.updateMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', productId: 'product-1', quantity: { gte: expect.anything() } },
      data: { quantity: { decrement: expect.anything() } },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CONFIRM_ORDER',
        entityId: 'sale-1',
        metadata: { saleNumber: 'STORE001-0001', total: '30' },
      }),
    });
    expect(confirmada.status).toBe('COMPLETED');
  });

  it('no reajusta la utilidad cuando el costo del lote coincide con el de la línea', async () => {
    prepararConfirmacion('10.00');

    await confirmOrder('sale-1', 'store-1', 'user-1');

    // Solo el update de estado: el ajuste quedó en cero.
    expect(prismaMock.sale.update).toHaveBeenCalledTimes(1);
    expect(argsDe(prismaMock.sale.update).data.status).toBe('COMPLETED');
  });

  it('usa margen cero cuando el total del pedido es cero', async () => {
    prepararConfirmacion('12.00');
    prismaMock.sale.findFirst.mockResolvedValue(
      pedidoPendiente({ total: dec('0.00'), profit: dec('10.00') })
    );

    await confirmOrder('sale-1', 'store-1', 'user-1');

    const ajuste = argsDe(prismaMock.sale.update, 0).data;
    expect(Number(ajuste.profit)).toBe(6);
    expect(Number(ajuste.profitMargin)).toBe(0);
  });

  it('lanza INSUFFICIENT_STOCK si el inventario ya no alcanza al confirmar', async () => {
    prepararConfirmacion('10.00');
    prismaMock.inventory.updateMany.mockResolvedValue({ count: 0 });

    await expectApiError(() => confirmOrder('sale-1', 'store-1', 'user-1'), {
      status: 400,
      code: 'INSUFFICIENT_STOCK',
      message: 'Stock insuficiente al deducir inventario',
    });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// holdSale
// ───────────────────────────────────────────────────────────────────────────

describe('holdSale', () => {
  it('lanza ORDER_NOT_FOUND si la venta no existe en la tienda', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expectApiError(() => holdSale('sale-x', 'store-1', 'user-1'), {
      status: 404,
      code: 'ORDER_NOT_FOUND',
      message: 'Pedido no encontrado',
    });
  });

  it('lanza ORDER_ALREADY_ON_HOLD si la venta ya está en espera', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(saleFixture({ id: 'sale-1', status: 'ON_HOLD' }));

    await expectApiError(() => holdSale('sale-1', 'store-1', 'user-1'), {
      status: 400,
      code: 'ORDER_ALREADY_ON_HOLD',
    });
    expect(prismaMock.sale.update).not.toHaveBeenCalled();
  });

  it('lanza ORDER_COMPLETED_CANNOT_HOLD si la venta está completada', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(saleFixture({ id: 'sale-1', status: 'COMPLETED' }));

    await expectApiError(() => holdSale('sale-1', 'store-1', 'user-1'), {
      status: 400,
      code: 'ORDER_COMPLETED_CANNOT_HOLD',
    });
    expect(prismaMock.sale.update).not.toHaveBeenCalled();
  });

  it('pone el pedido en espera y registra la auditoría', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(
      saleFixture({ id: 'sale-1', saleNumber: 'STORE001-0004', status: 'PENDING' })
    );
    prismaMock.sale.update.mockResolvedValue(saleFixture({ id: 'sale-1', status: 'ON_HOLD' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const enEspera = await holdSale('sale-1', 'store-1', 'user-1');

    expect(prismaMock.sale.update).toHaveBeenCalledWith({
      where: { id: 'sale-1' },
      data: { status: 'ON_HOLD' },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'HOLD_SALE',
        entityId: 'sale-1',
        metadata: { saleNumber: 'STORE001-0004', previousStatus: 'PENDING', newStatus: 'ON_HOLD' },
      }),
    });
    expect(enEspera.status).toBe('ON_HOLD');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// listHeldSales
// ───────────────────────────────────────────────────────────────────────────

describe('listHeldSales', () => {
  it('lista las ventas en espera de la tienda con sus productos', async () => {
    prismaMock.sale.findMany.mockResolvedValue([saleFixture({ id: 'sale-1', status: 'ON_HOLD' })]);

    const ventas = await listHeldSales('store-1');

    expect(prismaMock.sale.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', status: 'ON_HOLD' },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    });
    expect(ventas).toHaveLength(1);
  });

  it('devuelve una lista vacía cuando no hay ventas en espera', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await expect(listHeldSales('store-1')).resolves.toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// deleteHeldSale
// ───────────────────────────────────────────────────────────────────────────

describe('deleteHeldSale', () => {
  it('lanza HELD_SALE_NOT_FOUND si la venta en espera no existe', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expectApiError(() => deleteHeldSale('sale-x', 'store-1', 'user-1'), {
      status: 404,
      code: 'HELD_SALE_NOT_FOUND',
      message: 'Pedido en espera no encontrado',
    });
    expect(prismaMock.sale.update).not.toHaveBeenCalled();
  });

  it('marca la venta en espera como cancelada y audita', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(
      saleFixture({ id: 'sale-1', saleNumber: 'STORE001-0002', status: 'ON_HOLD' })
    );
    prismaMock.sale.update.mockResolvedValue(saleFixture({ id: 'sale-1', status: 'CANCELED' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    fijarAhora();

    const eliminada = await deleteHeldSale('sale-1', 'store-1', 'user-5');

    const data = argsDe(prismaMock.sale.update).data;
    expect(data.status).toBe('CANCELED');
    expect(data.canceledAt).toEqual(AHORA);
    expect(data.canceledBy).toBe('user-5');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'DELETE_HELD_SALE',
        metadata: { saleNumber: 'STORE001-0002', previousStatus: 'ON_HOLD', newStatus: 'CANCELED' },
      }),
    });
    expect(eliminada.status).toBe('CANCELED');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// clearHeldSales
// ───────────────────────────────────────────────────────────────────────────

describe('clearHeldSales', () => {
  it('lanza NO_HELD_SALES cuando no hay ventas en espera', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await expectApiError(() => clearHeldSales('store-1', 'user-1'), {
      status: 404,
      code: 'NO_HELD_SALES',
      message: 'No hay pedidos en espera en esta tienda',
    });
    expect(prismaMock.sale.updateMany).not.toHaveBeenCalled();
  });

  it('cancela todas las ventas en espera y devuelve el conteo', async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      { id: 'sale-1', saleNumber: 'STORE001-0001' },
      { id: 'sale-2', saleNumber: 'STORE001-0002' },
    ]);
    prismaMock.sale.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    fijarAhora();

    const resultado = await clearHeldSales('store-1', 'user-3');

    expect(prismaMock.sale.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', status: 'ON_HOLD' },
      select: { id: true, saleNumber: true },
    });
    const data = argsDe(prismaMock.sale.updateMany).data;
    expect(data.status).toBe('CANCELED');
    expect(data.canceledAt).toEqual(AHORA);
    expect(data.canceledBy).toBe('user-3');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CLEAR_HELD_SALES',
        entityId: 'store-1',
        metadata: { count: 2, saleNumbers: ['STORE001-0001', 'STORE001-0002'] },
      }),
    });
    expect(resultado).toEqual({ count: 2 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// retrieveHeldSale
// ───────────────────────────────────────────────────────────────────────────

describe('retrieveHeldSale', () => {
  it('devuelve la venta en espera con producto, usuario y cliente', async () => {
    const venta = {
      ...saleFixture({ id: 'sale-1', status: 'ON_HOLD' }),
      items: [saleItemFixture({ id: 'saleitem-1' })],
      user: { id: 'user-1', name: 'Vendedor de Prueba', email: 'vendedor@servicaja.com' },
      cliente: { id: 'cliente-1', nombreRazonSocial: 'Público en General', rfc: 'XAXX010101000' },
    };
    prismaMock.sale.findFirst.mockResolvedValue(venta);

    const resultado = await retrieveHeldSale('sale-1', 'store-1');

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith({
      where: { id: 'sale-1', storeId: 'store-1', status: 'ON_HOLD' },
      include: {
        items: { include: { product: { include: { category: true } } } },
        user: { select: { id: true, name: true, email: true } },
        cliente: { select: { id: true, nombreRazonSocial: true, rfc: true } },
      },
    });
    expect(resultado).toBe(venta);
  });

  it('lanza HELD_SALE_NOT_FOUND si la venta en espera no existe', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expectApiError(() => retrieveHeldSale('sale-x', 'store-1'), {
      status: 404,
      code: 'HELD_SALE_NOT_FOUND',
      message: 'Pedido en espera no encontrado',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// completeHeldSale
// ───────────────────────────────────────────────────────────────────────────

function prepararVentaEnEspera(costoLote: string): void {
  prismaMock.sale.findFirst.mockResolvedValue(pedidoPendiente({ status: 'ON_HOLD' }));
  prismaMock.inventory.findMany.mockResolvedValue([{ productId: 'product-1', quantity: dec('10.000') }]);
  prismaMock.inventoryLot.findMany.mockResolvedValue([
    inventoryLotFixture({ id: 'lot-1', productId: 'product-1', availableQty: dec('10.000'), unitCost: dec(costoLote) }),
  ]);
  prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.saleItem.update.mockResolvedValue({ id: 'saleitem-1' });
  prismaMock.saleItemLot.create.mockResolvedValue({ id: 'sil-1' });
  prismaMock.inventory.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.sale.update.mockResolvedValue(saleFixture({ id: 'sale-1', status: 'COMPLETED' }));
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
}

describe('completeHeldSale', () => {
  it('lanza HELD_SALE_NOT_FOUND si la venta en espera no existe', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expectApiError(() => completeHeldSale('sale-x', 'store-1', 'user-1'), {
      status: 404,
      code: 'HELD_SALE_NOT_FOUND',
      message: 'Pedido en espera no encontrado o ya completado',
    });
    expect(prismaMock.sale.update).not.toHaveBeenCalled();
  });

  it('completa la venta en espera con el método de pago indicado', async () => {
    prepararVentaEnEspera('10.00');
    fijarAhora();

    const completada = await completeHeldSale('sale-1', 'store-1', 'user-7', 'CARD');

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith({
      where: { id: 'sale-1', storeId: 'store-1', status: 'ON_HOLD' },
      include: { items: true },
    });
    const data = argsDe(prismaMock.sale.update).data;
    expect(data).toMatchObject({
      status: 'COMPLETED',
      confirmedBy: 'user-7',
      paymentMethod: 'CARD',
    });
    expect(data.confirmedAt).toEqual(AHORA);
    expect(prismaMock.inventory.updateMany).toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'COMPLETE_HELD_SALE',
        entityId: 'sale-1',
        metadata: { saleNumber: 'STORE001-0001', total: '30' },
      }),
    });
    expect(completada.status).toBe('COMPLETED');
  });

  it('conserva el método de pago original cuando no se envía uno nuevo', async () => {
    prepararVentaEnEspera('10.00');

    await completeHeldSale('sale-1', 'store-1', 'user-1');

    const data = argsDe(prismaMock.sale.update).data;
    expect(data).not.toHaveProperty('paymentMethod');
    expect(data.status).toBe('COMPLETED');
  });

  it('ajusta la utilidad al costo real de los lotes al completar', async () => {
    prepararVentaEnEspera('12.00');

    await completeHeldSale('sale-1', 'store-1', 'user-1');

    expect(prismaMock.sale.update).toHaveBeenCalledTimes(2);
    expect(Number(argsDe(prismaMock.sale.update, 0).data.profit)).toBe(6);
    expect(Number(argsDe(prismaMock.saleItem.update).data.costPrice)).toBe(12);
  });

  it('lanza INSUFFICIENT_STOCK si no hay existencias al completar', async () => {
    prepararVentaEnEspera('10.00');
    prismaMock.inventory.updateMany.mockResolvedValue({ count: 0 });

    await expectApiError(() => completeHeldSale('sale-1', 'store-1', 'user-1'), {
      status: 400,
      code: 'INSUFFICIENT_STOCK',
      message: 'Stock insuficiente al deducir inventario',
    });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// cancelOrder
// ───────────────────────────────────────────────────────────────────────────

describe('cancelOrder', () => {
  it('lanza ORDER_NOT_FOUND si el pedido no existe o ya fue confirmado', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expectApiError(() => cancelOrder('sale-x', 'store-1', 'user-1'), {
      status: 404,
      code: 'ORDER_NOT_FOUND',
      message: 'Pedido no encontrado o ya confirmado',
    });
    expect(prismaMock.sale.update).not.toHaveBeenCalled();
  });

  it('cancela el pedido pendiente sin tocar el inventario y audita', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(
      saleFixture({ id: 'sale-1', saleNumber: 'STORE001-0008', status: 'PENDING' })
    );
    prismaMock.sale.update.mockResolvedValue(saleFixture({ id: 'sale-1', status: 'CANCELED' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    fijarAhora();

    const cancelado = await cancelOrder('sale-1', 'store-1', 'user-2');

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith({
      where: { id: 'sale-1', storeId: 'store-1', status: 'PENDING' },
    });
    const data = argsDe(prismaMock.sale.update).data;
    expect(data.status).toBe('CANCELED');
    expect(data.canceledAt).toEqual(AHORA);
    expect(data.canceledBy).toBe('user-2');
    expect(prismaMock.inventory.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CANCEL_ORDER',
        entity: 'SALE',
        entityId: 'sale-1',
        metadata: { saleNumber: 'STORE001-0008' },
      }),
    });
    expect(cancelado.status).toBe('CANCELED');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// listOrders
// ───────────────────────────────────────────────────────────────────────────

describe('listOrders', () => {
  it('lista solo los pedidos pendientes cuando el estatus es PENDING', async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      { ...ventaConItems({ status: 'PENDING', clienteId: 'cliente-1' }), cliente: clienteFixture() },
    ]);

    const pedidos = await listOrders({ storeId: 'store-1', status: 'PENDING' });

    expect(argsDe(prismaMock.sale.findMany)).toEqual({
      where: { storeId: 'store-1', status: 'PENDING' },
      include: {
        items: { include: { product: true } },
        user: { select: { id: true, name: true, email: true } },
        cliente: { select: { id: true, nombreRazonSocial: true, rfc: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // El cliente incluido viaja tal cual y los montos salen como números.
    expect((pedidos[0] as any).cliente.id).toBe('cliente-1');
    expect(pedidos[0].total).toBe(100);
    expect(pedidos[0].items[0]).toMatchObject({ quantity: 2, productName: 'Refresco 600ml' });
  });

  it('no filtra por estatus cuando el filtro es ALL', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await listOrders({ storeId: 'store-1', status: 'ALL' });

    const where = argsDe(prismaMock.sale.findMany).where;
    expect(where).toEqual({ storeId: 'store-1' });
    expect(where).not.toHaveProperty('status');
  });

  it.each(['COMPLETED', 'CANCELED'])('filtra los pedidos con estatus %s', async (status) => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await listOrders({ storeId: 'store-1', status: status as 'COMPLETED' | 'CANCELED' });

    expect(argsDe(prismaMock.sale.findMany).where).toEqual({ storeId: 'store-1', status });
  });

  it('filtra por rango de fechas del día de negocio', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await listOrders({ storeId: 'store-1', status: 'PENDING', startDate: '2026-01-05', endDate: '2026-01-06' });

    expect(argsDe(prismaMock.sale.findMany).where).toEqual({
      storeId: 'store-1',
      status: 'PENDING',
      createdAt: { gte: mexicoStartOfDay('2026-01-05'), lte: mexicoEndOfDay('2026-01-06') },
    });
  });

  it('filtra solo con fecha inicial', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await listOrders({ storeId: 'store-1', status: 'ALL', startDate: '2026-01-05' });

    expect(argsDe(prismaMock.sale.findMany).where).toEqual({
      storeId: 'store-1',
      createdAt: { gte: mexicoStartOfDay('2026-01-05') },
    });
  });

  it('filtra solo con fecha final', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await listOrders({ storeId: 'store-1', status: 'ALL', endDate: '2026-01-06' });

    expect(argsDe(prismaMock.sale.findMany).where).toEqual({
      storeId: 'store-1',
      createdAt: { lte: mexicoEndOfDay('2026-01-06') },
    });
  });

  it('devuelve una lista vacía cuando no hay pedidos', async () => {
    prismaMock.sale.findMany.mockResolvedValue([]);

    await expect(listOrders({ storeId: 'store-1', status: 'PENDING' })).resolves.toEqual([]);
  });
});



