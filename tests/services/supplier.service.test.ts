import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import {
  dec,
  inventoryFixture,
  inventoryLotFixture,
  productFixture,
  storeFixture,
  supplierFixture,
} from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import {
  cancelSupplierTransaction,
  createSupplier,
  createSupplierTransaction,
  getSupplierTransactionById,
  getSupplierTransactions,
  listStoreTransactions,
  listSuppliers,
  updateSupplier,
} from '../../src/services/supplier.service';

// ── Builders locales ───────────────────────────────────────────────────────
// El detalle de una compra se arma con includes anidados; estos helpers
// reproducen la forma que Prisma devuelve para esos `select`/`include`.
function itemCompra(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-compra-1',
    transactionId: 'tx-1',
    productId: 'product-1',
    quantity: dec('2.000'),
    unitCost: dec('10.00'),
    marginPct: dec('16'),
    sellingPrice: dec('11.60'),
    ...overrides,
  };
}

function loteCompra(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lot-1',
    lotCode: null,
    expirationDate: null,
    receivedQty: dec('2.000'),
    availableQty: dec('2.000'),
    unitCost: dec('10.00'),
    status: 'ACTIVE',
    ...overrides,
  };
}

function detalleCompra(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    reference: 'COMPRA-STORE001-0001',
    total: dec('20.00'),
    status: 'COMPLETED',
    items: [
      {
        id: 'item-1',
        transactionId: 'tx-1',
        productId: 'product-1',
        quantity: dec('2.000'),
        unitCost: dec('10.00'),
        marginPct: dec('16'),
        sellingPrice: dec('11.60'),
      },
    ],
    ...overrides,
  };
}

/**
 * Deja listos los mocks que necesita `createSupplierTransaction` en su camino
 * feliz: proveedor, tienda, productos, ítems, lotes, movimientos de entrada y
 * el detalle final que devuelve `getSupplierTransactionById`.
 */
function configurarCompra(
  opciones: { producto?: Record<string, unknown>; inventario?: unknown } = {}
) {
  const producto = opciones.producto ?? productFixture({ id: 'product-1' });

  prismaMock.supplier.findFirst.mockResolvedValue(supplierFixture({ id: 'supplier-1' }));
  prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-1' }));
  prismaMock.product.findMany.mockResolvedValue([producto]);
  prismaMock.supplierTransaction.create.mockResolvedValue({ id: 'tx-1' });
  prismaMock.supplierTransactionItem.create.mockResolvedValue({ id: 'item-1' });
  prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-1' }));
  prismaMock.product.update.mockResolvedValue(producto);
  prismaMock.movementReason.findFirst.mockResolvedValue({
    id: 'reason-1',
    name: 'Compra a proveedor',
  });
  prismaMock.product.findFirst.mockResolvedValue(producto);
  prismaMock.inventory.findUnique.mockResolvedValue(opciones.inventario ?? null);
  prismaMock.inventory.create.mockResolvedValue(inventoryFixture({ quantity: dec('2.000') }));
  prismaMock.inventory.update.mockResolvedValue(inventoryFixture({ quantity: dec('12.000') }));
  prismaMock.stockMovement.create.mockResolvedValue({ id: 'mov-1' });
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  prismaMock.supplierTransaction.findFirst.mockResolvedValue(detalleCompra());

  return producto;
}

function entradaCompra(overrides: Record<string, unknown> = {}) {
  return {
    supplierId: 'supplier-1',
    storeId: 'store-1',
    userId: 'user-1',
    paymentMethod: 'CASH',
    items: [{ productId: 'product-1', quantity: 2, unitCost: 10 }],
    ...overrides,
  };
}

describe('listSuppliers', () => {
  it('sin tienda ni búsqueda lista todos los proveedores por nombre', async () => {
    const filas = [supplierFixture({ id: 'supplier-1' })];
    prismaMock.supplier.findMany.mockResolvedValue(filas);

    await expect(listSuppliers()).resolves.toEqual(filas);
    expect(prismaMock.supplier.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { name: 'asc' },
    });
  });

  it('filtra por tienda y por nombre recortando el término', async () => {
    prismaMock.supplier.findMany.mockResolvedValue([]);

    await listSuppliers('store-1', '  norte  ');

    expect(prismaMock.supplier.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 'store-1',
        name: { contains: 'norte', mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
    });
  });

  it('ignora una búsqueda en blanco', async () => {
    prismaMock.supplier.findMany.mockResolvedValue([]);

    await listSuppliers('store-1', '   ');

    expect(prismaMock.supplier.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      orderBy: { name: 'asc' },
    });
  });
});

describe('createSupplier', () => {
  it('crea el proveedor solo con el nombre y audita la creación', async () => {
    const creado = supplierFixture({ id: 'supplier-7', name: 'Distribuidora del Norte' });
    prismaMock.supplier.create.mockResolvedValue(creado);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await createSupplier({ name: 'Distribuidora del Norte', storeId: 'store-1' }, 'user-1');

    expect(resultado).toEqual(creado);
    expect(prismaMock.supplier.create).toHaveBeenCalledWith({
      data: {
        name: 'Distribuidora del Norte',
        rfc: undefined,
        phone: undefined,
        email: undefined,
        address: undefined,
        city: undefined,
        state: undefined,
        postalCode: undefined,
        storeId: 'store-1',
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'CREATE',
        entity: 'SUPPLIER',
        entityId: 'supplier-7',
        metadata: { name: 'Distribuidora del Norte' },
      },
    });
  });

  it('guarda los datos fiscales y de contacto cuando se envían', async () => {
    const creado = supplierFixture({ id: 'supplier-8', name: 'Norte SA' });
    prismaMock.supplier.create.mockResolvedValue(creado);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await createSupplier(
      {
        name: 'Norte SA',
        rfc: 'NRT010101AAA',
        phone: '6671234567',
        email: 'compras@norte.mx',
        address: 'Calle 1',
        city: 'Culiacán',
        state: 'Sinaloa',
        postalCode: '81200',
        storeId: 'store-1',
      },
      'user-1'
    );

    expect(prismaMock.supplier.create).toHaveBeenCalledWith({
      data: {
        name: 'Norte SA',
        rfc: 'NRT010101AAA',
        phone: '6671234567',
        email: 'compras@norte.mx',
        address: 'Calle 1',
        city: 'Culiacán',
        state: 'Sinaloa',
        postalCode: '81200',
        storeId: 'store-1',
      },
    });
  });
});

describe('updateSupplier', () => {
  it('lanza SUPPLIER_NOT_FOUND si el proveedor no existe', async () => {
    prismaMock.supplier.findUnique.mockResolvedValue(null);

    await expectApiError(() => updateSupplier('supplier-x', { name: 'Nuevo' }, 'user-1'), {
      status: 404,
      code: 'SUPPLIER_NOT_FOUND',
    });
    expect(prismaMock.supplier.update).not.toHaveBeenCalled();
  });

  it('actualiza solo los campos enviados y permite limpiarlos con null', async () => {
    prismaMock.supplier.findUnique.mockResolvedValue(supplierFixture({ id: 'supplier-1' }));
    prismaMock.supplier.update.mockResolvedValue(
      supplierFixture({ id: 'supplier-1', name: 'Nuevo' })
    );
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-3' });

    await updateSupplier('supplier-1', { name: 'Nuevo', rfc: null }, 'user-1');

    expect(prismaMock.supplier.update).toHaveBeenCalledWith({
      where: { id: 'supplier-1' },
      data: { name: 'Nuevo', rfc: null },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'UPDATE',
        entity: 'SUPPLIER',
        entityId: 'supplier-1',
        metadata: { changes: { name: 'Nuevo', rfc: null } },
      },
    });
  });

  it('limpia todos los datos de contacto y fiscales cuando llegan en null', async () => {
    prismaMock.supplier.findUnique.mockResolvedValue(supplierFixture({ id: 'supplier-1' }));
    prismaMock.supplier.update.mockResolvedValue(supplierFixture({ id: 'supplier-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-5' });

    await updateSupplier(
      'supplier-1',
      { rfc: null, phone: null, email: null, address: null, city: null, state: null, postalCode: null },
      'user-1'
    );

    expect(prismaMock.supplier.update).toHaveBeenCalledWith({
      where: { id: 'supplier-1' },
      data: {
        rfc: null,
        phone: null,
        email: null,
        address: null,
        city: null,
        state: null,
        postalCode: null,
      },
    });
  });

  it('actualiza todos los campos cuando llegan completos', async () => {
    prismaMock.supplier.findUnique.mockResolvedValue(supplierFixture({ id: 'supplier-1' }));
    prismaMock.supplier.update.mockResolvedValue(supplierFixture({ id: 'supplier-1', rfc: 'NRT010101AAA' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-4' });

    await updateSupplier(
      'supplier-1',
      {
        name: 'Norte SA',
        rfc: 'NRT010101AAA',
        phone: '6671234567',
        email: 'compras@norte.mx',
        address: 'Calle 1',
        city: 'Culiacán',
        state: 'Sinaloa',
        postalCode: '81200',
      },
      'user-1'
    );

    expect(prismaMock.supplier.update).toHaveBeenCalledWith({
      where: { id: 'supplier-1' },
      data: {
        name: 'Norte SA',
        rfc: 'NRT010101AAA',
        phone: '6671234567',
        email: 'compras@norte.mx',
        address: 'Calle 1',
        city: 'Culiacán',
        state: 'Sinaloa',
        postalCode: '81200',
      },
    });
  });
});

describe('getSupplierTransactions', () => {
  it('serializa el total y los importes de ítems y lotes', async () => {
    prismaMock.supplierTransaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        reference: 'COMPRA-STORE001-0001',
        total: dec('30.00'),
        items: [
          itemCompra({
            lots: [
              loteCompra({ expirationDate: new Date('2026-03-01T00:00:00.000Z'), lotCode: 'L1' }),
              loteCompra({ id: 'lot-2', expirationDate: null }),
            ],
          }),
          itemCompra({ id: 'item-compra-2', productId: 'product-2', sellingPrice: null }),
        ],
      },
    ]);

    const [fila] = await getSupplierTransactions('supplier-1', 'store-1');

    expect(prismaMock.supplierTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { supplierId: 'supplier-1', storeId: 'store-1' } })
    );
    expect(fila.total).toBe(30);
    expect(fila.reference).toBe('COMPRA-STORE001-0001');

    const items = fila.items as any[];
    expect(items).toHaveLength(2);
    expect(items[0].quantity).toBe(2);
    expect(items[0].unitCost).toBe(10);
    expect(items[0].sellingPrice).toBe(11.6);
    expect(items[0].lots).toEqual([
      {
        id: 'lot-1',
        lotCode: 'L1',
        expirationDate: '2026-03-01',
        receivedQty: 2,
        availableQty: 2,
        unitCost: 10,
        status: 'ACTIVE',
      },
      expect.objectContaining({ id: 'lot-2', expirationDate: null }),
    ]);
    // Ítem sin `lots` y con precio de venta nulo.
    expect(items[1].sellingPrice).toBeNull();
    expect(items[1].lots).toEqual([]);
  });
});

describe('getSupplierTransactionById', () => {
  it('lanza SUPPLIER_TX_NOT_FOUND si la compra no está en la tienda', async () => {
    prismaMock.supplierTransaction.findFirst.mockResolvedValue(null);

    await expectApiError(() => getSupplierTransactionById('tx-x', 'store-1'), {
      status: 404,
      code: 'SUPPLIER_TX_NOT_FOUND',
    });
  });

  it('devuelve el detalle con el subtotal por ítem calculado', async () => {
    prismaMock.supplierTransaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      reference: 'COMPRA-STORE001-0001',
      total: dec('20.00'),
      items: [itemCompra({ quantity: dec('2.000'), unitCost: dec('10.00') })],
    });

    const detalle = await getSupplierTransactionById('tx-1', 'store-1');

    expect(prismaMock.supplierTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tx-1', storeId: 'store-1' } })
    );
    expect(detalle.total).toBe(20);
    expect((detalle.items as any[])[0].subtotal).toBe(20);
  });

  it('acepta un cliente de transacción explícito', async () => {
    prismaMock.supplierTransaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      reference: 'COMPRA-STORE001-0001',
      total: dec('0.00'),
      items: [],
    });

    const detalle = await getSupplierTransactionById(
      'tx-1',
      'store-1',
      prismaMock as unknown as Parameters<typeof getSupplierTransactionById>[2]
    );

    expect(detalle.total).toBe(0);
    expect(detalle.items).toEqual([]);
  });
});

describe('listStoreTransactions', () => {
  it('sin filtros solo limita por tienda', async () => {
    prismaMock.supplierTransaction.findMany.mockResolvedValue([]);

    await listStoreTransactions('store-1');

    const args = prismaMock.supplierTransaction.findMany.mock.calls[0]?.[0] as any;
    expect(args.where).toEqual({ storeId: 'store-1' });
  });

  it('filtra por rango completo de fechas y serializa los ítems', async () => {
    prismaMock.supplierTransaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        reference: 'COMPRA-STORE001-0001',
        total: dec('20.00'),
        items: [itemCompra({ quantity: dec('2.000'), unitCost: dec('10.00') })],
      },
    ]);

    const filas = await listStoreTransactions('store-1', {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    const args = prismaMock.supplierTransaction.findMany.mock.calls[0]?.[0] as any;
    expect(args.where.createdAt.gte).toBeInstanceOf(Date);
    expect(args.where.createdAt.lte).toBeInstanceOf(Date);
    expect(filas[0].total).toBe(20);
    expect((filas[0].items as any[])[0].subtotal).toBe(20);
  });

  it('aplica solo la fecha inicial', async () => {
    prismaMock.supplierTransaction.findMany.mockResolvedValue([]);

    await listStoreTransactions('store-1', { startDate: '2026-01-01' });

    const args = prismaMock.supplierTransaction.findMany.mock.calls[0]?.[0] as any;
    expect(args.where.createdAt.gte).toBeInstanceOf(Date);
    expect(args.where.createdAt.lte).toBeUndefined();
  });

  it('aplica solo la fecha final', async () => {
    prismaMock.supplierTransaction.findMany.mockResolvedValue([]);

    await listStoreTransactions('store-1', { endDate: '2026-01-31' });

    const args = prismaMock.supplierTransaction.findMany.mock.calls[0]?.[0] as any;
    expect(args.where.createdAt.gte).toBeUndefined();
    expect(args.where.createdAt.lte).toBeInstanceOf(Date);
  });
});

describe('createSupplierTransaction', () => {
  it('lanza SUPPLIER_NOT_FOUND si el proveedor no pertenece a la tienda', async () => {
    prismaMock.supplier.findFirst.mockResolvedValue(null);

    await expectApiError(() => createSupplierTransaction(entradaCompra()), {
      status: 404,
      code: 'SUPPLIER_NOT_FOUND',
    });
    expect(prismaMock.supplierTransaction.create).not.toHaveBeenCalled();
  });

  it('lanza STORE_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.supplier.findFirst.mockResolvedValue(supplierFixture({ id: 'supplier-1' }));
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => createSupplierTransaction(entradaCompra()), {
      status: 404,
      code: 'STORE_NOT_FOUND',
    });
  });

  it('lanza PRODUCT_NOT_FOUND si algún producto no es de la tienda', async () => {
    prismaMock.supplier.findFirst.mockResolvedValue(supplierFixture({ id: 'supplier-1' }));
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-1' }));
    prismaMock.product.findMany.mockResolvedValue([]);

    await expectApiError(() => createSupplierTransaction(entradaCompra()), {
      status: 400,
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('lanza INVALID_INPUT si el costo unitario no es positivo', async () => {
    prismaMock.supplier.findFirst.mockResolvedValue(supplierFixture({ id: 'supplier-1' }));
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-1' }));
    prismaMock.product.findMany.mockResolvedValue([productFixture({ id: 'product-1' })]);

    await expectApiError(
      () =>
        createSupplierTransaction(
          entradaCompra({ items: [{ productId: 'product-1', quantity: 2, unitCost: 0 }] })
        ),
      { status: 400, code: 'INVALID_INPUT' }
    );
  });

  it('lanza INVALID_INPUT si la cantidad no es positiva', async () => {
    prismaMock.supplier.findFirst.mockResolvedValue(supplierFixture({ id: 'supplier-1' }));
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-1' }));
    prismaMock.product.findMany.mockResolvedValue([productFixture({ id: 'product-1' })]);

    await expectApiError(
      () =>
        createSupplierTransaction(
          entradaCompra({ items: [{ productId: 'product-1', quantity: 0, unitCost: 10 }] })
        ),
      { status: 400, code: 'INVALID_INPUT' }
    );
  });

  it('lanza LOTES_NO_COINCIDEN si la suma de lotes no cuadra con la cantidad', async () => {
    prismaMock.supplier.findFirst.mockResolvedValue(supplierFixture({ id: 'supplier-1' }));
    prismaMock.store.findUnique.mockResolvedValue(storeFixture({ id: 'store-1' }));
    prismaMock.product.findMany.mockResolvedValue([productFixture({ id: 'product-1' })]);

    await expectApiError(
      () =>
        createSupplierTransaction(
          entradaCompra({
            items: [
              {
                productId: 'product-1',
                quantity: 2,
                unitCost: 10,
                lots: [{ quantity: 1 }],
              },
            ],
          })
        ),
      { status: 400, code: 'LOTES_NO_COINCIDEN', message: /no coincide con la cantidad/ }
    );
    expect(prismaMock.supplierTransaction.create).not.toHaveBeenCalled();
  });

  it('registra la compra con un lote implícito, margen por defecto y pago de dueño', async () => {
    configurarCompra();

    const resultado = await createSupplierTransaction(entradaCompra());

    expect(resultado).toEqual(
      expect.objectContaining({
        id: 'tx-1',
        reference: 'COMPRA-STORE001-0001',
        total: 20,
        status: 'COMPLETED',
      })
    );
    expect((resultado.items as any[])[0]).toEqual(
      expect.objectContaining({
        productId: 'product-1',
        quantity: 2,
        unitCost: 10,
        subtotal: 20,
        lots: [],
      })
    );

    const creada = prismaMock.supplierTransaction.create.mock.calls[0]?.[0] as any;
    expect(creada.data.reference).toBe('COMPRA-STORE001-0001');
    expect(Number(creada.data.total)).toBe(20);
    expect(creada.data.paidFrom).toBe('DUENO');
    expect(creada.data.paymentMethod).toBe('CASH');
    expect(creada.data.cajaSessionId).toBeUndefined();
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { purchaseSequence: 1 },
    });

    // Margen por defecto (16%) y precio sugerido = costo * 1.16.
    const item = prismaMock.supplierTransactionItem.create.mock.calls[0]?.[0] as any;
    expect(Number(item.data.marginPct)).toBe(16);
    expect(Number(item.data.sellingPrice)).toBeCloseTo(11.6, 5);
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: expect.objectContaining({ costPrice: expect.anything() }),
    });

    // Un solo lote sin caducidad, con la cantidad completa.
    const lote = prismaMock.inventoryLot.create.mock.calls[0]?.[0] as any;
    expect(Number(lote.data.receivedQty)).toBe(2);
    expect(lote.data.expirationDate).toBeNull();
    expect(lote.data.lotCode).toBeNull();
    expect(lote.data.supplierTransactionItemId).toBe('item-1');

    // Entrada de inventario y movimiento trazable.
    expect(prismaMock.inventory.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          referenceType: 'SUPPLIER_TX',
          referenceId: 'tx-1',
          tipo: 'ENTRADA',
        }),
      })
    );

    const audit = prismaMock.auditLog.create.mock.calls.at(-1)?.[0] as any;
    expect(audit.data).toEqual(
      expect.objectContaining({
        action: 'SUPPLIER_TRANSACTION',
        entity: 'SUPPLIER_TRANSACTION',
        entityId: 'tx-1',
      })
    );
    expect(audit.data.metadata).toEqual(
      expect.objectContaining({ items: 1, lots: 1, paymentMethod: 'CASH', total: '20' })
    );
  });

  it('crea el motivo de compra y empieza el folio en 0001 cuando la tienda no tiene secuencia', async () => {
    configurarCompra();
    prismaMock.store.findUnique.mockResolvedValue({
      ...storeFixture({ id: 'store-1' }),
      purchaseSequence: null as unknown as number,
    });
    prismaMock.movementReason.findFirst.mockResolvedValue(null);
    prismaMock.movementReason.create.mockResolvedValue({ id: 'reason-nuevo' });

    await createSupplierTransaction(entradaCompra());

    const creada = prismaMock.supplierTransaction.create.mock.calls[0]?.[0] as any;
    expect(creada.data.reference).toBe('COMPRA-STORE001-0001');
    expect(prismaMock.movementReason.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        name: 'Compra a proveedor',
        tipo: 'ENTRADA',
        isActive: true,
      }),
    });
  });

  it('respeta los lotes capturados y vincula la sesión de caja cuando se paga de caja', async () => {
    configurarCompra({ inventario: inventoryFixture({ quantity: dec('5.000') }) });
    prismaMock.store.findUnique.mockResolvedValue(
      storeFixture({ id: 'store-1', purchaseSequence: 2 })
    );
    prismaMock.cajaSession.findFirst.mockResolvedValue({ id: 'cs-1', status: 'OPEN' });

    await createSupplierTransaction(
      entradaCompra({
        paidFrom: 'CAJA',
        cajaSessionId: 'cs-1',
        items: [
          {
            productId: 'product-1',
            quantity: 2,
            unitCost: 10,
            marginPct: 50,
            sellingPrice: 25,
            lots: [
              { quantity: 1, unitCost: 8, expirationDate: '2026-03-01', lotCode: ' L1 ' },
              { quantity: 1 },
            ],
          },
        ],
      })
    );

    const creada = prismaMock.supplierTransaction.create.mock.calls[0]?.[0] as any;
    expect(creada.data.paidFrom).toBe('CAJA');
    expect(creada.data.cajaSessionId).toBe('cs-1');
    expect(creada.data.reference).toBe('COMPRA-STORE001-0003');
    // 1 * 8 + 1 * 10 (el segundo lote hereda el costo de la línea).
    expect(Number(creada.data.total)).toBe(18);

    const item = prismaMock.supplierTransactionItem.create.mock.calls[0]?.[0] as any;
    expect(Number(item.data.marginPct)).toBe(50);
    expect(Number(item.data.sellingPrice)).toBe(25);

    const lotes = prismaMock.inventoryLot.create.mock.calls.map((c) => c[0] as any);
    expect(lotes).toHaveLength(2);
    expect(Number(lotes[0].data.unitCost)).toBe(8);
    expect(lotes[0].data.lotCode).toBe('L1');
    expect(lotes[0].data.expirationDate).toEqual(new Date(Date.UTC(2026, 2, 1)));
    expect(Number(lotes[1].data.unitCost)).toBe(10);
    expect(lotes[1].data.expirationDate).toBeNull();

    // Ya existía inventario: se incrementa en lugar de crearse.
    expect(prismaMock.inventory.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.inventory.create).not.toHaveBeenCalled();
  });

  it('resuelve la sesión de caja abierta cuando no se envía cajaSessionId', async () => {
    configurarCompra();
    prismaMock.cajaSession.findFirst.mockResolvedValue({ id: 'cs-9' });

    await createSupplierTransaction(
      entradaCompra({ paidFrom: 'CAJA', items: [{ productId: 'product-1', quantity: 1, unitCost: 10 }] })
    );

    const creada = prismaMock.supplierTransaction.create.mock.calls[0]?.[0] as any;
    expect(creada.data.cajaSessionId).toBe('cs-9');
  });

  it('trata una lista de lotes vacía como un único lote sin caducidad', async () => {
    configurarCompra();

    await createSupplierTransaction(
      entradaCompra({
        items: [{ productId: 'product-1', quantity: 3, unitCost: 10, lots: [] }],
      })
    );

    expect(prismaMock.inventoryLot.create).toHaveBeenCalledTimes(1);
    const lote = prismaMock.inventoryLot.create.mock.calls[0]?.[0] as any;
    expect(Number(lote.data.receivedQty)).toBe(3);
  });
});

describe('cancelSupplierTransaction', () => {
  function configurarCancelacion(overrides: Record<string, unknown> = {}) {
    prismaMock.supplierTransaction.findFirst.mockResolvedValue(detalleCompra(overrides));
    prismaMock.movementReason.findFirst.mockResolvedValue({
      id: 'reason-salida',
      name: 'Cancelación de compra',
    });
    prismaMock.product.findFirst.mockResolvedValue(productFixture({ id: 'product-1' }));
    prismaMock.inventory.findUnique.mockResolvedValue(inventoryFixture({ quantity: dec('10.000') }));
    prismaMock.inventoryLot.count.mockResolvedValue(1);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({
        id: 'lot-1',
        availableQty: dec('2.000'),
        supplierTransactionItemId: 'item-1',
      }),
    ]);
    prismaMock.inventoryLot.update.mockResolvedValue({});
    prismaMock.inventory.update.mockResolvedValue(inventoryFixture({ quantity: dec('8.000') }));
    prismaMock.stockMovement.create.mockResolvedValue({ id: 'mov-1' });
    prismaMock.supplierTransaction.update.mockResolvedValue({ id: 'tx-1', status: 'CANCELED' });
    prismaMock.cancellation.create.mockResolvedValue({ id: 'cancel-1' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  }

  it('lanza SUPPLIER_TX_NOT_FOUND si la compra no existe o ya está cancelada', async () => {
    prismaMock.supplierTransaction.findFirst.mockResolvedValue(null);

    await expectApiError(() => cancelSupplierTransaction('tx-x', 'store-1', 'user-1'), {
      status: 404,
      code: 'SUPPLIER_TX_NOT_FOUND',
    });
  });

  it('cancela sin motivo: revierte inventario y no crea registro de cancelación', async () => {
    configurarCancelacion();

    const resultado = await cancelSupplierTransaction('tx-1', 'store-1', 'user-1');

    expect(resultado).toEqual({ id: 'tx-1', status: 'CANCELED' });
    expect(prismaMock.supplierTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tx-1', storeId: 'store-1', status: 'COMPLETED' },
      })
    );

    const actualizada = prismaMock.supplierTransaction.update.mock.calls[0]?.[0] as any;
    expect(actualizada.data).toEqual({
      status: 'CANCELED',
      canceledAt: expect.any(Date),
      canceledBy: 'user-1',
    });

    // Salida de inventario con el movimiento inverso vinculado a la compra.
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipo: 'SALIDA',
          referenceType: 'SUPPLIER_TX',
          referenceId: 'tx-1',
        }),
      })
    );
    expect(prismaMock.inventory.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.cancellation.create).not.toHaveBeenCalled();

    const audit = prismaMock.auditLog.create.mock.calls.at(-1)?.[0] as any;
    expect(audit.data).toEqual(
      expect.objectContaining({ action: 'CANCEL_SUPPLIER_TX', entityId: 'tx-1' })
    );
    expect(audit.data.metadata).toEqual({ reference: 'COMPRA-STORE001-0001', total: '20' });
  });

  it('cancela con motivo y comentario: registra la cancelación y la audita', async () => {
    configurarCancelacion();

    await cancelSupplierTransaction('tx-1', 'store-1', 'user-1', 'motivo-1', 'producto dañado');

    const actualizada = prismaMock.supplierTransaction.update.mock.calls[0]?.[0] as any;
    expect(actualizada.data).toEqual(
      expect.objectContaining({
        cancellationReasonId: 'motivo-1',
        cancellationComment: 'producto dañado',
      })
    );

    expect(prismaMock.cancellation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        userId: 'user-1',
        entityType: 'SUPPLIER_TRANSACTION',
        entityId: 'tx-1',
        entityNumber: 'COMPRA-STORE001-0001',
        type: 'FULL',
        cancellationReasonId: 'motivo-1',
        comment: 'producto dañado',
      }),
    });

    const audit = prismaMock.auditLog.create.mock.calls.at(-1)?.[0] as any;
    expect(audit.data.metadata).toEqual(
      expect.objectContaining({ cancellationReasonId: 'motivo-1', comment: 'producto dañado' })
    );
  });

  it('guarda el comentario nulo sin agregarlo a la auditoría', async () => {
    configurarCancelacion();

    await cancelSupplierTransaction('tx-1', 'store-1', 'user-1', 'motivo-1', null);

    const actualizada = prismaMock.supplierTransaction.update.mock.calls[0]?.[0] as any;
    expect(actualizada.data.cancellationComment).toBeNull();

    const audit = prismaMock.auditLog.create.mock.calls.at(-1)?.[0] as any;
    expect(audit.data.metadata.comment).toBeUndefined();
    expect(audit.data.metadata.cancellationReasonId).toBe('motivo-1');
  });
});
