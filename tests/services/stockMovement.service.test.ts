import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { prismaMock } from '../helpers/prismaMock';
import { dec, inventoryLotFixture } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import {
  cancelMovement,
  createMovement,
  createMovementBatch,
  createPurchaseMovementsInTx,
  createSupplierCancelMovementsInTx,
  getInventoryReport,
  hasOpening,
  listMovements,
  registerOpening,
} from '../../src/services/stockMovement.service';

// ───────────────────────────────────────────────────────────────────────────
// Utilidades locales
// ───────────────────────────────────────────────────────────────────────────

/** 18:00 UTC = 11:00 en America/Mazatlan: día de negocio 2026-01-15. */
const HOY = new Date('2026-01-15T18:00:00.000Z');
const INICIO_DIA = new Date('2026-01-15T07:00:00.000Z');
const FIN_DIA = new Date('2026-01-16T06:59:59.999Z');

function fijarHoy(fecha: Date = HOY): void {
  vi.useFakeTimers();
  vi.setSystemTime(fecha);
}

afterEach(() => {
  vi.useRealTimers();
});

const PRODUCTO = {
  id: 'product-1',
  name: 'Refresco 600ml',
  unidadVenta: 'UNIDAD',
  costPrice: dec('10.00'),
};

function motivoFila(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reason-1',
    storeId: 'store-1',
    name: 'Merma',
    tipo: 'SALIDA',
    isActive: true,
    ...overrides,
  };
}

function movimientoFila(overrides: Record<string, unknown> = {}) {
  return {
    id: 'movement-1',
    storeId: 'store-1',
    productId: 'product-1',
    product: { name: 'Refresco 600ml', unidadVenta: 'UNIDAD' },
    userId: 'user-1',
    user: { id: 'user-1', name: 'Vendedor de Prueba' },
    reasonId: 'reason-1',
    reason: { id: 'reason-1', name: 'Merma', tipo: 'SALIDA' },
    tipo: 'SALIDA',
    quantity: dec('2.000'),
    balanceBefore: dec('10.000'),
    balanceAfter: dec('8.000'),
    unitCost: dec('10.00'),
    batchId: null,
    lossValue: null,
    comment: null,
    status: 'ACTIVE',
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    cancellationComment: null,
    createdAt: HOY,
    ...overrides,
  };
}

interface OpcionesEntrada {
  inventario?: { quantity: Prisma.Decimal } | null;
  inventarioActualizado?: { quantity: Prisma.Decimal };
  inventarioCreado?: { quantity: Prisma.Decimal };
  costPrice?: Prisma.Decimal | null;
  movimiento?: Record<string, unknown>;
}

/** Deja lista la ruta de ENTRADA de `applyInventoryDelta`. */
function prepararEntrada(opciones: OpcionesEntrada = {}): void {
  prismaMock.movementReason.findFirst.mockResolvedValue(motivoFila({ tipo: 'ENTRADA' }));
  prismaMock.product.findFirst.mockResolvedValue(PRODUCTO);
  prismaMock.inventory.findUnique.mockResolvedValue(opciones.inventario ?? null);
  prismaMock.product.findUnique.mockResolvedValue(
    opciones.costPrice === undefined ? { costPrice: dec('10.00') } : opciones.costPrice
  );
  prismaMock.inventoryLot.create.mockResolvedValue(
    inventoryLotFixture({ id: 'lot-1', availableQty: dec('5.000'), unitCost: dec('10.00') })
  );
  prismaMock.inventory.update.mockResolvedValue(
    opciones.inventarioActualizado ?? { quantity: dec('12.000') }
  );
  prismaMock.inventory.create.mockResolvedValue(
    opciones.inventarioCreado ?? { quantity: dec('5.000') }
  );
  prismaMock.stockMovement.create.mockResolvedValue(
    opciones.movimiento ?? movimientoFila({ tipo: 'ENTRADA', lossValue: null })
  );
}

interface OpcionesSalida {
  stock?: Prisma.Decimal;
  lotes?: Record<string, unknown>[];
  movimiento?: Record<string, unknown>;
}

/** Deja lista la ruta de SALIDA (consumo FEFO) de `applyInventoryDelta`. */
function prepararSalida(opciones: OpcionesSalida = {}): void {
  const stock = opciones.stock ?? dec('10.000');
  prismaMock.movementReason.findFirst.mockResolvedValue(motivoFila({ tipo: 'SALIDA' }));
  prismaMock.product.findFirst.mockResolvedValue(PRODUCTO);
  prismaMock.inventory.findUnique.mockResolvedValue({ quantity: stock });
  prismaMock.inventory.findMany.mockResolvedValue([{ productId: 'product-1', quantity: stock }]);
  prismaMock.inventoryLot.findMany.mockResolvedValue(
    opciones.lotes ?? [
      inventoryLotFixture({
        id: 'lot-1',
        productId: 'product-1',
        availableQty: stock,
        unitCost: dec('10.00'),
      }),
    ]
  );
  prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.inventory.update.mockResolvedValue({ quantity: dec('8.000') });
  prismaMock.product.findUnique.mockResolvedValue({ costPrice: dec('10.00') });
  prismaMock.stockMovement.create.mockResolvedValue(
    opciones.movimiento ?? movimientoFila()
  );
}

// ───────────────────────────────────────────────────────────────────────────
// createMovement
// ───────────────────────────────────────────────────────────────────────────

describe('createMovement', () => {
  it('registra una entrada creando el lote y el inventario del producto', async () => {
    fijarHoy();
    prepararEntrada();

    const resultado = await createMovement({
      storeId: 'store-1',
      userId: 'user-1',
      productId: 'product-1',
      reasonId: 'reason-1',
      quantity: 5,
      comment: 'Compra de la semana',
      referenceType: 'SUPPLIER_TX',
      referenceId: 'stx-1',
      expirationDate: '2026-03-01',
      lotCode: 'L-01',
    });

    expect(prismaMock.movementReason.findFirst).toHaveBeenCalledWith({
      where: { id: 'reason-1', storeId: 'store-1', isActive: true },
    });
    expect(prismaMock.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'product-1', storeId: 'store-1' },
      select: { id: true, name: true, unidadVenta: true, costPrice: true },
    });
    expect(prismaMock.inventory.findUnique).toHaveBeenCalledWith({
      where: { storeId_productId: { storeId: 'store-1', productId: 'product-1' } },
    });

    const lote = prismaMock.inventoryLot.create.mock.calls[0]?.[0] as any;
    expect(lote.data).toMatchObject({
      storeId: 'store-1',
      productId: 'product-1',
      lotCode: 'L-01',
      status: 'ACTIVE',
    });
    expect(lote.data.expirationDate).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    expect(String(lote.data.unitCost)).toBe('10');
    expect(String(lote.data.receivedQty)).toBe('5');

    const inventario = prismaMock.inventory.create.mock.calls[0]?.[0] as any;
    expect(inventario.data).toEqual({
      storeId: 'store-1',
      productId: 'product-1',
      quantity: dec('5'),
    });

    const movimiento = prismaMock.stockMovement.create.mock.calls[0]?.[0] as any;
    expect(movimiento.data).toMatchObject({
      storeId: 'store-1',
      productId: 'product-1',
      userId: 'user-1',
      reasonId: 'reason-1',
      tipo: 'ENTRADA',
      unitCost: dec('10.00'),
      comment: 'Compra de la semana',
      referenceType: 'SUPPLIER_TX',
      referenceId: 'stx-1',
      status: 'ACTIVE',
    });
    expect(String(movimiento.data.balanceBefore)).toBe('0');
    expect(String(movimiento.data.balanceAfter)).toBe('5');
    expect(String(movimiento.data.quantity)).toBe('5');

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        userId: 'user-1',
        action: 'STOCK_MOVEMENT',
        entity: 'StockMovement',
        entityId: 'movement-1',
        metadata: {
          tipo: 'ENTRADA',
          productId: 'product-1',
          quantity: 5,
          reason: 'Merma',
          comment: 'Compra de la semana',
        },
      }),
    });

    expect(resultado).toMatchObject({
      id: 'movement-1',
      productName: 'Refresco 600ml',
      unidadVenta: 'UNIDAD',
      userName: 'Vendedor de Prueba',
      reasonName: 'Merma',
      reasonTipo: 'SALIDA',
      tipo: 'ENTRADA',
      quantity: 2,
      balanceBefore: 10,
      balanceAfter: 8,
      unitCost: 10,
      lossValue: null,
      batchId: null,
      createdAt: HOY.toISOString(),
    });
  });

  it('incrementa el inventario existente y acepta cantidades en texto', async () => {
    prepararEntrada({ inventario: { quantity: dec('7.000') } });

    await createMovement({
      storeId: 'store-1',
      userId: 'user-1',
      productId: 'product-1',
      reasonId: 'reason-1',
      quantity: '3.500' as any,
    });

    expect(prismaMock.inventory.create).not.toHaveBeenCalled();
    const actualizacion = prismaMock.inventory.update.mock.calls[0]?.[0] as any;
    expect(actualizacion.where).toEqual({
      storeId_productId: { storeId: 'store-1', productId: 'product-1' },
    });
    expect(String(actualizacion.data.quantity.increment)).toBe('3.5');

    const movimiento = prismaMock.stockMovement.create.mock.calls[0]?.[0] as any;
    expect(String(movimiento.data.balanceBefore)).toBe('7');
    expect(String(movimiento.data.balanceAfter)).toBe('12');
    expect(movimiento.data.comment).toBeNull();
    expect(movimiento.data.referenceType).toBeNull();
    expect(movimiento.data.referenceId).toBeNull();
  });

  it('usa costo cero para el lote cuando el producto no tiene costo', async () => {
    prepararEntrada({ costPrice: null });

    await createMovement({
      storeId: 'store-1',
      userId: 'user-1',
      productId: 'product-1',
      reasonId: 'reason-1',
      quantity: 2,
    });

    const lote = prismaMock.inventoryLot.create.mock.calls[0]?.[0] as any;
    expect(String(lote.data.unitCost)).toBe('0');
    expect(lote.data.expirationDate).toBeNull();
    expect(lote.data.lotCode).toBeNull();
  });

  it('serializa en null las relaciones y campos opcionales ausentes', async () => {
    prepararEntrada({
      movimiento: {
        id: 'movement-9',
        storeId: 'store-1',
        productId: 'product-1',
        product: null,
        userId: null,
        user: null,
        reasonId: 'reason-1',
        reason: null,
        tipo: 'ENTRADA',
        quantity: dec('1.000'),
        balanceBefore: dec('0.000'),
        balanceAfter: dec('1.000'),
        unitCost: dec('0.00'),
        batchId: null,
        lossValue: null,
        comment: null,
        status: 'ACTIVE',
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        cancellationComment: null,
        createdAt: HOY,
      },
    });

    const resultado = await createMovement({
      storeId: 'store-1',
      userId: 'user-1',
      productId: 'product-1',
      reasonId: 'reason-1',
      quantity: 1,
    });

    expect(resultado).toMatchObject({
      id: 'movement-9',
      productName: null,
      unidadVenta: null,
      userName: null,
      reasonName: null,
      // Sin relación `reason` cae al tipo del propio movimiento.
      reasonTipo: 'ENTRADA',
      lossValue: null,
      batchId: null,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      cancellationComment: null,
    });
  });

  it('lanza REASON_NOT_FOUND cuando el motivo no existe o está inactivo', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(null);

    await expectApiError(
      () =>
        createMovement({
          storeId: 'store-1',
          userId: 'user-1',
          productId: 'product-1',
          reasonId: 'reason-9',
          quantity: 1,
        }),
      {
        status: 400,
        code: 'REASON_NOT_FOUND',
        message: 'Motivo de movimiento no válido o inactivo',
      }
    );
    expect(prismaMock.product.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
  });

  it('lanza PRODUCT_NOT_FOUND cuando el producto no pertenece a la tienda', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(motivoFila({ tipo: 'ENTRADA' }));
    prismaMock.product.findFirst.mockResolvedValue(null);

    await expectApiError(
      () =>
        createMovement({
          storeId: 'store-1',
          userId: 'user-1',
          productId: 'product-9',
          reasonId: 'reason-1',
          quantity: 1,
        }),
      { status: 404, code: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' }
    );
    expect(prismaMock.inventory.findUnique).not.toHaveBeenCalled();
  });

  it('registra una salida consumiendo lotes por FEFO', async () => {
    prepararSalida();

    const resultado = await createMovement({
      storeId: 'store-1',
      userId: 'user-1',
      productId: 'product-1',
      reasonId: 'reason-1',
      quantity: 2,
    });

    expect(prismaMock.inventoryLot.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', productId: { in: ['product-1'] }, availableQty: { gt: 0 } },
      orderBy: [{ expirationDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const consumo = prismaMock.inventoryLot.updateMany.mock.calls[0]?.[0] as any;
    expect(consumo.where).toEqual({ id: 'lot-1', availableQty: { gte: dec('2') } });
    expect(String(consumo.data.availableQty.decrement)).toBe('2');

    const inventario = prismaMock.inventory.update.mock.calls[0]?.[0] as any;
    expect(String(inventario.data.quantity.decrement)).toBe('2');
    // Una salida nunca crea lote.
    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ id: 'movement-1', quantity: 2 });
  });

  it('lanza INSUFFICIENT_STOCK cuando la salida supera el saldo', async () => {
    prepararSalida({ stock: dec('1.000') });

    await expectApiError(
      () =>
        createMovement({
          storeId: 'store-1',
          userId: 'user-1',
          productId: 'product-1',
          reasonId: 'reason-1',
          quantity: 5,
        }),
      {
        status: 400,
        code: 'INSUFFICIENT_STOCK',
        message: 'Stock insuficiente para aplicar la salida de inventario',
      }
    );
    expect(prismaMock.inventoryLot.findMany).not.toHaveBeenCalled();
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// createMovementBatch
// ───────────────────────────────────────────────────────────────────────────

describe('createMovementBatch', () => {
  it('rechaza un lote sin productos', async () => {
    await expectApiError(
      () =>
        createMovementBatch({
          storeId: 'store-1',
          userId: 'user-1',
          reasonId: 'reason-1',
          items: [],
        }),
      {
        status: 400,
        code: 'EMPTY_BATCH',
        message: 'El lote debe incluir al menos un producto',
      }
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('lanza REASON_NOT_FOUND cuando el motivo no existe', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(null);

    await expectApiError(
      () =>
        createMovementBatch({
          storeId: 'store-1',
          userId: 'user-1',
          reasonId: 'reason-9',
          items: [{ productId: 'product-1', quantity: 1 }],
        }),
      { status: 400, code: 'REASON_NOT_FOUND' }
    );
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
  });

  it('lanza PRODUCT_NOT_FOUND indicando el producto que falló', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(motivoFila({ tipo: 'ENTRADA' }));
    prismaMock.product.findFirst
      .mockResolvedValueOnce(PRODUCTO)
      .mockResolvedValueOnce(null);
    prismaMock.inventory.findUnique.mockResolvedValue(null);
    prismaMock.product.findUnique.mockResolvedValue({ costPrice: dec('10.00') });
    prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-1' }));
    prismaMock.inventory.create.mockResolvedValue({ quantity: dec('1.000') });
    prismaMock.stockMovement.create.mockResolvedValue(movimientoFila({ tipo: 'ENTRADA' }));

    await expectApiError(
      () =>
        createMovementBatch({
          storeId: 'store-1',
          userId: 'user-1',
          reasonId: 'reason-1',
          items: [
            { productId: 'product-1', quantity: 1 },
            { productId: 'product-2', quantity: 1 },
          ],
        }),
      {
        status: 404,
        code: 'PRODUCT_NOT_FOUND',
        message: 'Producto no encontrado: product-2',
      }
    );
    expect(prismaMock.stockMovement.create).toHaveBeenCalledTimes(1);
  });

  it('registra una entrada por producto compartiendo batchId y comentarios', async () => {
    prepararEntrada();

    const resultado = await createMovementBatch({
      storeId: 'store-1',
      userId: 'user-1',
      reasonId: 'reason-1',
      comment: 'Comentario del lote',
      referenceType: 'AJUSTE',
      referenceId: 'ajuste-1',
      items: [
        { productId: 'product-1', quantity: 5, comment: 'Comentario del ítem', expirationDate: '2026-03-01', lotCode: 'L-01' },
        { productId: 'product-2', quantity: 1 },
      ],
    });

    expect(resultado).toHaveLength(2);
    expect(prismaMock.stockMovement.create).toHaveBeenCalledTimes(2);

    const primero = prismaMock.stockMovement.create.mock.calls[0]?.[0] as any;
    const segundo = prismaMock.stockMovement.create.mock.calls[1]?.[0] as any;

    expect(primero.data.batchId).toMatch(/^batch_\d+_[a-z0-9]+$/);
    expect(segundo.data.batchId).toBe(primero.data.batchId);
    expect(primero.data).toMatchObject({
      tipo: 'ENTRADA',
      comment: 'Comentario del ítem',
      referenceType: 'AJUSTE',
      referenceId: 'ajuste-1',
      lossValue: null,
    });
    // Sin comentario propio cae al comentario del lote.
    expect(segundo.data.comment).toBe('Comentario del lote');

    const lote = prismaMock.inventoryLot.create.mock.calls[0]?.[0] as any;
    expect(lote.data.lotCode).toBe('L-01');
    expect(lote.data.expirationDate).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    // El segundo ítem no trae caducidad.
    const loteSegundo = prismaMock.inventoryLot.create.mock.calls[1]?.[0] as any;
    expect(loteSegundo.data.expirationDate).toBeNull();
    expect(loteSegundo.data.lotCode).toBeNull();

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(2);
    const auditoria = prismaMock.auditLog.create.mock.calls[1]?.[0] as any;
    expect(auditoria.data).toMatchObject({
      action: 'STOCK_MOVEMENT',
      entity: 'StockMovement',
      metadata: {
        batchId: primero.data.batchId,
        tipo: 'ENTRADA',
        productId: 'product-2',
        quantity: 1,
        reason: 'Merma',
        comment: 'Comentario del lote',
      },
    });
  });

  it('registra una salida con la pérdida valorizada por producto', async () => {
    prepararSalida();

    const resultado = await createMovementBatch({
      storeId: 'store-1',
      userId: 'user-1',
      reasonId: 'reason-1',
      items: [
        { productId: 'product-1', quantity: 2 },
        { productId: 'product-1', quantity: 3 },
      ],
    });

    expect(resultado).toHaveLength(2);
    const primero = prismaMock.stockMovement.create.mock.calls[0]?.[0] as any;
    const segundo = prismaMock.stockMovement.create.mock.calls[1]?.[0] as any;
    expect(Number(primero.data.lossValue)).toBe(20);
    expect(Number(segundo.data.lossValue)).toBe(30);
    // Sin comentarios en ningún nivel queda null.
    expect(primero.data.comment).toBeNull();
    expect(primero.data.referenceType).toBeNull();
    expect(primero.data.referenceId).toBeNull();
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// listMovements
// ───────────────────────────────────────────────────────────────────────────

describe('listMovements', () => {
  it('sin filtros lista todos los movimientos de la tienda', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([movimientoFila()]);

    const resultado = await listMovements('store-1');

    const args = prismaMock.stockMovement.findMany.mock.calls[0]?.[0] as any;
    expect(args.where).toEqual({ storeId: 'store-1' });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.include).toMatchObject({
      product: { select: { name: true, unidadVenta: true } },
      reason: { select: { id: true, name: true, tipo: true } },
      user: { select: { id: true, name: true } },
    });
    expect(resultado).toEqual([
      {
        id: 'movement-1',
        storeId: 'store-1',
        productId: 'product-1',
        productName: 'Refresco 600ml',
        unidadVenta: 'UNIDAD',
        userId: 'user-1',
        userName: 'Vendedor de Prueba',
        reasonId: 'reason-1',
        reasonName: 'Merma',
        reasonTipo: 'SALIDA',
        tipo: 'SALIDA',
        quantity: 2,
        balanceBefore: 10,
        balanceAfter: 8,
        unitCost: 10,
        lossValue: null,
        batchId: null,
        comment: null,
        status: 'ACTIVE',
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        cancellationComment: null,
        createdAt: HOY.toISOString(),
      },
    ]);
  });

  it('serializa la anulación y la pérdida valorizada', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([
      movimientoFila({
        status: 'CANCELLED',
        cancelledAt: HOY,
        cancelledBy: 'user-2',
        cancellationReason: 'Error de captura',
        cancellationComment: 'Se capturó dos veces',
        lossValue: dec('25.00'),
        batchId: 'batch_1',
        comment: 'Merma de refrescos',
      }),
    ]);

    const [movimiento] = await listMovements('store-1');

    expect(movimiento).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: HOY.toISOString(),
      cancelledBy: 'user-2',
      cancellationReason: 'Error de captura',
      cancellationComment: 'Se capturó dos veces',
      lossValue: 25,
      batchId: 'batch_1',
      comment: 'Merma de refrescos',
    });
  });

  it('aplica los filtros de producto, tipo, motivo y estatus', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([]);

    await listMovements('store-1', {
      productId: 'product-1',
      tipo: 'SALIDA' as any,
      reasonId: 'reason-1',
      status: 'CANCELLED',
    });

    const args = prismaMock.stockMovement.findMany.mock.calls[0]?.[0] as any;
    expect(args.where).toEqual({
      storeId: 'store-1',
      productId: 'product-1',
      tipo: 'SALIDA',
      reasonId: 'reason-1',
      status: 'CANCELLED',
    });
    expect(args.where).not.toHaveProperty('createdAt');
  });

  it('filtra desde la fecha inicial en día de negocio', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([]);

    await listMovements('store-1', { startDate: '2026-01-15' });

    const args = prismaMock.stockMovement.findMany.mock.calls[0]?.[0] as any;
    expect(args.where.createdAt).toEqual({ gte: INICIO_DIA });
  });

  it('filtra hasta la fecha final en día de negocio', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([]);

    await listMovements('store-1', { endDate: '2026-01-15' });

    const args = prismaMock.stockMovement.findMany.mock.calls[0]?.[0] as any;
    expect(args.where.createdAt).toEqual({ lte: FIN_DIA });
  });

  it('combina el rango completo de fechas', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([]);

    await listMovements('store-1', { startDate: '2026-01-15', endDate: '2026-01-15' });

    const args = prismaMock.stockMovement.findMany.mock.calls[0]?.[0] as any;
    expect(args.where.createdAt).toEqual({ gte: INICIO_DIA, lte: FIN_DIA });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// cancelMovement
// ───────────────────────────────────────────────────────────────────────────

describe('cancelMovement', () => {
  it('lanza MOVEMENT_NOT_FOUND cuando no existe o ya está cancelado', async () => {
    prismaMock.stockMovement.findFirst.mockResolvedValue(null);

    await expectApiError(
      () => cancelMovement('movement-9', 'store-1', 'user-1', 'Error'),
      {
        status: 404,
        code: 'MOVEMENT_NOT_FOUND',
        message: 'Movimiento no encontrado o ya cancelado',
      }
    );
    expect(prismaMock.stockMovement.findFirst).toHaveBeenCalledWith({
      where: { id: 'movement-9', storeId: 'store-1', status: 'ACTIVE' },
    });
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
  });

  it('revierte una salida creando la entrada inversa', async () => {
    fijarHoy();
    prismaMock.stockMovement.findFirst.mockResolvedValue(
      movimientoFila({ tipo: 'SALIDA', quantity: dec('2.000'), unitCost: dec('10.00') })
    );
    prismaMock.product.findUnique.mockResolvedValue({ costPrice: dec('10.00') });
    prismaMock.inventory.findUnique.mockResolvedValue(null);
    prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-1' }));
    prismaMock.inventory.create.mockResolvedValue({ quantity: dec('2.000') });
    prismaMock.stockMovement.create.mockResolvedValue(
      movimientoFila({ id: 'movement-2', tipo: 'ENTRADA', lossValue: null })
    );

    const resultado = await cancelMovement('movement-1', 'store-1', 'user-2', 'Error de captura');

    const inverso = prismaMock.stockMovement.create.mock.calls[0]?.[0] as any;
    expect(inverso.data).toMatchObject({
      storeId: 'store-1',
      productId: 'product-1',
      userId: 'user-2',
      reasonId: 'reason-1',
      tipo: 'ENTRADA',
      comment: 'Anulación de movimiento movement-1',
      status: 'ACTIVE',
      unitCost: dec('10.00'),
    });
    expect(String(inverso.data.quantity)).toBe('2');
    expect(String(inverso.data.balanceBefore)).toBe('0');
    expect(String(inverso.data.balanceAfter)).toBe('2');

    const actualizacion = prismaMock.stockMovement.update.mock.calls[0]?.[0] as any;
    expect(actualizacion.where).toEqual({ id: 'movement-1' });
    expect(actualizacion.data).toEqual({
      status: 'CANCELLED',
      cancelledAt: HOY,
      cancelledBy: 'user-2',
      cancellationReason: 'Error de captura',
      cancellationComment: null,
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CANCEL_STOCK_MOVEMENT',
        entity: 'StockMovement',
        entityId: 'movement-1',
        metadata: {
          cancelledMovementId: 'movement-1',
          inverseMovementId: 'movement-2',
          reason: 'Error de captura',
          comment: null,
        },
      }),
    });
    expect(resultado).toMatchObject({ id: 'movement-2', tipo: 'ENTRADA' });
  });

  it('revierte una entrada consumiendo lotes por FEFO', async () => {
    prismaMock.stockMovement.findFirst.mockResolvedValue(
      movimientoFila({ tipo: 'ENTRADA', quantity: dec('3.000'), unitCost: dec('9.00') })
    );
    prismaMock.inventory.findUnique.mockResolvedValue({ quantity: dec('10.000') });
    prismaMock.inventory.findMany.mockResolvedValue([
      { productId: 'product-1', quantity: dec('10.000') },
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-1', productId: 'product-1', availableQty: dec('10.000') }),
    ]);
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.inventory.update.mockResolvedValue({ quantity: dec('7.000') });
    prismaMock.stockMovement.create.mockResolvedValue(
      movimientoFila({ id: 'movement-3', tipo: 'SALIDA' })
    );

    await cancelMovement('movement-1', 'store-1', 'user-2', null as any, 'Cancelado por error');

    const inverso = prismaMock.stockMovement.create.mock.calls[0]?.[0] as any;
    expect(inverso.data.tipo).toBe('SALIDA');
    expect(inverso.data.comment).toBe('Anulación de movimiento movement-1');
    const inventario = prismaMock.inventory.update.mock.calls[0]?.[0] as any;
    expect(String(inventario.data.quantity.decrement)).toBe('3');

    const actualizacion = prismaMock.stockMovement.update.mock.calls[0]?.[0] as any;
    expect(actualizacion.data.cancellationReason).toBeNull();
    expect(actualizacion.data.cancellationComment).toBe('Cancelado por error');
  });

  it('propaga INSUFFICIENT_STOCK si el inventario ya no alcanza para revertir', async () => {
    prismaMock.stockMovement.findFirst.mockResolvedValue(
      movimientoFila({ tipo: 'ENTRADA', quantity: dec('20.000') })
    );
    prismaMock.inventory.findUnique.mockResolvedValue({ quantity: dec('5.000') });

    await expectApiError(
      () => cancelMovement('movement-1', 'store-1', 'user-2', 'Error'),
      { status: 400, code: 'INSUFFICIENT_STOCK' }
    );
    expect(prismaMock.stockMovement.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// registerOpening
// ───────────────────────────────────────────────────────────────────────────

describe('registerOpening', () => {
  it('captura el snapshot de todos los productos de la tienda', async () => {
    fijarHoy();
    prismaMock.inventory.findMany.mockResolvedValue([
      { productId: 'product-1', quantity: dec('10.000') },
      { productId: 'product-2', quantity: dec('0.000') },
    ]);

    const resultado = await registerOpening('store-1');

    expect(prismaMock.inventory.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      select: { productId: true, quantity: true },
    });
    expect(prismaMock.inventorySnapshot.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.inventorySnapshot.upsert).toHaveBeenNthCalledWith(1, {
      where: {
        storeId_productId_date: { storeId: 'store-1', productId: 'product-1', date: INICIO_DIA },
      },
      create: {
        storeId: 'store-1',
        productId: 'product-1',
        date: INICIO_DIA,
        quantity: dec('10.000'),
      },
      update: { quantity: dec('10.000') },
    });
    expect(resultado).toEqual({ date: '2026-01-15', count: 2 });
  });

  it('usa la fecha indicada y no escribe nada sin inventario', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([]);

    const resultado = await registerOpening('store-1', '2026-02-01');

    expect(prismaMock.inventorySnapshot.upsert).not.toHaveBeenCalled();
    expect(resultado).toEqual({ date: '2026-02-01', count: 0 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// createPurchaseMovementsInTx
// ───────────────────────────────────────────────────────────────────────────

describe('createPurchaseMovementsInTx', () => {
  const entrada = {
    storeId: 'store-1',
    userId: 'user-1',
    reasonId: 'reason-1',
    referenceId: 'stx-1',
    items: [{ productId: 'product-1', quantity: 3, unitCost: dec('8.50') }],
  };

  it('registra la entrada sin crear lotes y con el costo de compra', async () => {
    prismaMock.product.findFirst.mockResolvedValue(PRODUCTO);
    prismaMock.inventory.findUnique.mockResolvedValue({ quantity: dec('5.000') });
    prismaMock.inventory.update.mockResolvedValue({ quantity: dec('8.000') });
    prismaMock.stockMovement.create.mockResolvedValue(movimientoFila({ tipo: 'ENTRADA' }));

    await createPurchaseMovementsInTx(prismaMock as never, entrada);

    // Los lotes los crea supplier.service: aquí solo se refleja el total.
    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
    const actualizacion = prismaMock.inventory.update.mock.calls[0]?.[0] as any;
    expect(String(actualizacion.data.quantity.increment)).toBe('3');

    const movimiento = prismaMock.stockMovement.create.mock.calls[0]?.[0] as any;
    expect(movimiento.data).toMatchObject({
      tipo: 'ENTRADA',
      referenceType: 'SUPPLIER_TX',
      referenceId: 'stx-1',
      status: 'ACTIVE',
      unitCost: dec('8.50'),
    });
    expect(String(movimiento.data.quantity)).toBe('3');
    expect(String(movimiento.data.balanceBefore)).toBe('5');
    expect(String(movimiento.data.balanceAfter)).toBe('8');

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'STOCK_MOVEMENT',
        entityId: 'movement-1',
        metadata: {
          tipo: 'ENTRADA',
          productId: 'product-1',
          quantity: 3,
          reason: 'Compra a proveedor',
          referenceId: 'stx-1',
        },
      }),
    });
  });

  it('crea el registro de inventario cuando el producto no tenía saldo', async () => {
    prismaMock.product.findFirst.mockResolvedValue(PRODUCTO);
    prismaMock.inventory.findUnique.mockResolvedValue(null);
    prismaMock.inventory.create.mockResolvedValue({ quantity: dec('3.000') });
    prismaMock.stockMovement.create.mockResolvedValue(movimientoFila({ tipo: 'ENTRADA' }));

    await createPurchaseMovementsInTx(prismaMock as never, entrada);

    const creado = prismaMock.inventory.create.mock.calls[0]?.[0] as any;
    expect(creado.data).toEqual({ storeId: 'store-1', productId: 'product-1', quantity: dec('3') });
    const movimiento = prismaMock.stockMovement.create.mock.calls[0]?.[0] as any;
    expect(String(movimiento.data.balanceBefore)).toBe('0');
  });

  it('lanza PRODUCT_NOT_FOUND cuando el producto no existe en la tienda', async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);

    await expectApiError(() => createPurchaseMovementsInTx(prismaMock as never, entrada), {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
      message: 'Producto no encontrado',
    });
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// createSupplierCancelMovementsInTx
// ───────────────────────────────────────────────────────────────────────────

describe('createSupplierCancelMovementsInTx', () => {
  const base = { storeId: 'store-1', userId: 'user-1', referenceId: 'stx-1' };

  it('lanza REASON_NOT_FOUND sin el motivo de cancelación de compra', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(null);

    await expectApiError(
      () =>
        createSupplierCancelMovementsInTx(prismaMock as never, {
          ...base,
          items: [{ productId: 'product-1', quantity: 1, unitCost: dec('10.00') }],
        }),
      {
        status: 400,
        code: 'REASON_NOT_FOUND',
        message: 'Motivo de cancelación de compra no encontrado',
      }
    );
    expect(prismaMock.movementReason.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 'store-1',
        name: 'Cancelación de compra',
        tipo: 'SALIDA',
        isActive: true,
      },
    });
  });

  it('lanza PRODUCT_NOT_FOUND cuando el producto ya no existe', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(motivoFila());
    prismaMock.product.findFirst.mockResolvedValue(null);

    await expectApiError(
      () =>
        createSupplierCancelMovementsInTx(prismaMock as never, {
          ...base,
          items: [{ productId: 'product-9', quantity: 1, unitCost: 10 }],
        }),
      { status: 404, code: 'PRODUCT_NOT_FOUND' }
    );
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
  });

  it('retira los lotes de la línea de compra cuando se conoce', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(motivoFila());
    prismaMock.product.findFirst.mockResolvedValue(PRODUCTO);
    prismaMock.inventory.findUnique.mockResolvedValue({ quantity: dec('10.000') });
    prismaMock.inventoryLot.count.mockResolvedValue(2);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-1', availableQty: dec('5.000') }),
    ]);
    prismaMock.inventoryLot.update.mockResolvedValue({ id: 'lot-1' });
    prismaMock.inventory.update.mockResolvedValue({ quantity: dec('5.000') });
    prismaMock.stockMovement.create.mockResolvedValue(movimientoFila());

    await createSupplierCancelMovementsInTx(prismaMock as never, {
      ...base,
      items: [
        {
          productId: 'product-1',
          quantity: dec('5.000'),
          unitCost: dec('10.00'),
          supplierTransactionItemId: 'sti-1',
        },
      ],
    });

    expect(prismaMock.inventoryLot.count).toHaveBeenCalledWith({
      where: { supplierTransactionItemId: 'sti-1' },
    });
    expect(prismaMock.inventoryLot.findMany).toHaveBeenCalledWith({
      where: { supplierTransactionItemId: 'sti-1', availableQty: { gt: 0 } },
      orderBy: [{ expirationDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });

    const movimiento = prismaMock.stockMovement.create.mock.calls[0]?.[0] as any;
    expect(movimiento.data).toMatchObject({
      tipo: 'SALIDA',
      reasonId: 'reason-1',
      referenceType: 'SUPPLIER_TX',
      referenceId: 'stx-1',
      unitCost: dec('10.00'),
      status: 'ACTIVE',
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: {
          tipo: 'SALIDA',
          productId: 'product-1',
          quantity: 5,
          reason: 'Cancelación de compra',
          referenceId: 'stx-1',
        },
      }),
    });
  });

  it('descarga por FEFO cuando la compra no tiene lotes vinculados', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(motivoFila());
    prismaMock.product.findFirst.mockResolvedValue(PRODUCTO);
    prismaMock.inventory.findUnique.mockResolvedValue({ quantity: dec('10.000') });
    prismaMock.inventoryLot.count.mockResolvedValue(0);
    prismaMock.inventory.findMany.mockResolvedValue([
      { productId: 'product-1', quantity: dec('10.000') },
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-1', productId: 'product-1', availableQty: dec('10.000') }),
    ]);
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.inventory.update.mockResolvedValue({ quantity: dec('8.000') });
    prismaMock.stockMovement.create.mockResolvedValue(movimientoFila());

    await createSupplierCancelMovementsInTx(prismaMock as never, {
      ...base,
      items: [
        {
          productId: 'product-1',
          quantity: 2,
          unitCost: 10,
          supplierTransactionItemId: 'sti-1',
        },
      ],
    });

    expect(prismaMock.inventoryLot.count).toHaveBeenCalledTimes(1);
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenCalledTimes(2);
    const inventario = prismaMock.inventory.update.mock.calls[0]?.[0] as any;
    expect(String(inventario.data.quantity.decrement)).toBe('2');
    const movimiento = prismaMock.stockMovement.create.mock.calls[0]?.[0] as any;
    expect(String(movimiento.data.quantity)).toBe('2');
  });

  it('descarga por FEFO cuando no se indica la línea de compra', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(motivoFila());
    prismaMock.product.findFirst.mockResolvedValue(PRODUCTO);
    prismaMock.inventory.findUnique.mockResolvedValue({ quantity: dec('10.000') });
    prismaMock.inventory.findMany.mockResolvedValue([
      { productId: 'product-1', quantity: dec('10.000') },
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-1', productId: 'product-1', availableQty: dec('10.000') }),
    ]);
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.inventory.update.mockResolvedValue({ quantity: dec('7.000') });
    prismaMock.stockMovement.create.mockResolvedValue(movimientoFila());

    await createSupplierCancelMovementsInTx(prismaMock as never, {
      ...base,
      items: [{ productId: 'product-1', quantity: 3, unitCost: dec('10.00') }],
    });

    expect(prismaMock.inventoryLot.count).not.toHaveBeenCalled();
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.stockMovement.create).toHaveBeenCalledTimes(1);
  });

  it('lanza LOTE_YA_CONSUMIDO cuando el lote ya se vendió', async () => {
    prismaMock.movementReason.findFirst.mockResolvedValue(motivoFila());
    prismaMock.product.findFirst.mockResolvedValue(PRODUCTO);
    prismaMock.inventory.findUnique.mockResolvedValue({ quantity: dec('10.000') });
    prismaMock.inventoryLot.count.mockResolvedValue(1);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-1', availableQty: dec('1.000') }),
    ]);
    prismaMock.inventoryLot.update.mockResolvedValue({ id: 'lot-1' });

    await expectApiError(
      () =>
        createSupplierCancelMovementsInTx(prismaMock as never, {
          ...base,
          items: [
            {
              productId: 'product-1',
              quantity: 5,
              unitCost: 10,
              supplierTransactionItemId: 'sti-1',
            },
          ],
        }),
      {
        status: 400,
        code: 'LOTE_YA_CONSUMIDO',
        message: /unidad\(es\) de ese lote ya se vendieron o ajustaron/,
      }
    );
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// hasOpening
// ───────────────────────────────────────────────────────────────────────────

describe('hasOpening', () => {
  it('marca true cuando existe el snapshot del día', async () => {
    fijarHoy();
    prismaMock.inventorySnapshot.count.mockResolvedValue(3);

    const resultado = await hasOpening('store-1');

    expect(prismaMock.inventorySnapshot.count).toHaveBeenCalledWith({
      where: { storeId: 'store-1', date: INICIO_DIA },
    });
    expect(resultado).toEqual({ date: '2026-01-15', hasOpening: true });
  });

  it('marca false sin snapshot y usa la fecha indicada', async () => {
    prismaMock.inventorySnapshot.count.mockResolvedValue(0);

    const resultado = await hasOpening('store-1', '2026-03-05');

    expect(resultado).toEqual({ date: '2026-03-05', hasOpening: false });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getInventoryReport
// ───────────────────────────────────────────────────────────────────────────

interface OpcionesReporteInventario {
  inventarios?: Record<string, unknown>[];
  snapshots?: Record<string, unknown>[];
  ventas?: Record<string, unknown>[];
  movimientos?: Record<string, unknown>[];
}

function prepararReporte(opciones: OpcionesReporteInventario = {}): void {
  prismaMock.inventory.findMany.mockResolvedValue(opciones.inventarios ?? []);
  prismaMock.inventorySnapshot.findMany.mockResolvedValue(opciones.snapshots ?? []);
  prismaMock.sale.findMany.mockResolvedValue(opciones.ventas ?? []);
  prismaMock.stockMovement.findMany.mockResolvedValue(opciones.movimientos ?? []);
}

function productoInventario(id: string, nombre: string, costo: string) {
  return { id, name: nombre, unidadVenta: 'UNIDAD', costPrice: dec(costo) };
}

describe('getInventoryReport', () => {
  it('reconstruye el inventario inicial y agrega las pérdidas por motivo', async () => {
    fijarHoy();
    prepararReporte({
      inventarios: [
        {
          productId: 'product-1',
          quantity: dec('5.000'),
          product: productoInventario('product-1', 'Refresco 600ml', '10.00'),
        },
        {
          productId: 'product-2',
          quantity: dec('8.000'),
          product: productoInventario('product-2', 'Sabritas', '12.00'),
        },
        {
          // Sin snapshots, ventas ni movimientos: todo cae a los valores por defecto.
          productId: 'product-3',
          quantity: dec('6.000'),
          product: productoInventario('product-3', 'Galletas', '7.50'),
        },
      ],
      snapshots: [{ productId: 'product-1', quantity: dec('10.000') }],
      ventas: [
        {
          id: 'sale-1',
          items: [
            { productId: 'product-1', quantity: dec('2.000') },
            { productId: 'product-1', quantity: dec('1.000') },
          ],
        },
      ],
      movimientos: [
        {
          productId: 'product-2',
          tipo: 'ENTRADA',
          referenceType: 'SUPPLIER_TX',
          quantity: dec('5.000'),
          lossValue: null,
          reason: { id: 'reason-1', name: 'Compra', tipo: 'ENTRADA' },
          product: productoInventario('product-2', 'Sabritas', '12.00'),
        },
        {
          productId: 'product-1',
          tipo: 'ENTRADA',
          referenceType: 'AJUSTE',
          quantity: dec('4.000'),
          lossValue: null,
          reason: { id: 'reason-3', name: 'Ajuste', tipo: 'ENTRADA' },
          product: productoInventario('product-1', 'Refresco 600ml', '10.00'),
        },
        {
          productId: 'product-1',
          tipo: 'SALIDA',
          referenceType: null,
          quantity: dec('2.000'),
          lossValue: dec('15.00'),
          reason: { id: 'reason-2', name: 'Merma', tipo: 'SALIDA' },
          product: productoInventario('product-1', 'Refresco 600ml', '10.00'),
        },
        {
          productId: 'product-2',
          tipo: 'SALIDA',
          referenceType: null,
          quantity: dec('1.000'),
          lossValue: null,
          reason: { id: 'reason-2', name: 'Merma', tipo: 'SALIDA' },
          product: productoInventario('product-2', 'Sabritas', '12.00'),
        },
      ],
    });

    const reporte = await getInventoryReport('store-1');

    expect(prismaMock.inventorySnapshot.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', date: INICIO_DIA },
    });
    expect(prismaMock.sale.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 'store-1',
        status: 'COMPLETED',
        createdAt: { gte: INICIO_DIA, lte: FIN_DIA },
      },
      include: { items: true },
    });
    expect(prismaMock.stockMovement.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 'store-1',
        status: 'ACTIVE',
        createdAt: { gte: INICIO_DIA, lte: FIN_DIA },
      },
      include: {
        reason: { select: { id: true, name: true, tipo: true } },
        product: { select: { id: true, name: true, unidadVenta: true, costPrice: true } },
      },
    });

    expect(reporte).toMatchObject({
      storeId: 'store-1',
      date: '2026-01-15',
      hasSnapshot: true,
      totalLossQuantity: 3,
      totalLossValue: 27,
    });
    expect(reporte.byProduct).toEqual([
      {
        productId: 'product-1',
        productName: 'Refresco 600ml',
        unidadVenta: 'UNIDAD',
        initial: 10,
        final: 5,
        ventas: 3,
        compras: 0,
        entradas: 4,
        salidas: 2,
        perdida: 2,
        perdidaValor: 20,
      },
      {
        productId: 'product-2',
        productName: 'Sabritas',
        unidadVenta: 'UNIDAD',
        // Sin snapshot: final + ventas + salidas - entradas (las compras ya van dentro).
        initial: 4,
        final: 8,
        ventas: 0,
        compras: 5,
        entradas: 5,
        salidas: 1,
        perdida: 1,
        perdidaValor: 12,
      },
      {
        productId: 'product-3',
        productName: 'Galletas',
        unidadVenta: 'UNIDAD',
        initial: 6,
        final: 6,
        ventas: 0,
        compras: 0,
        entradas: 0,
        salidas: 0,
        perdida: 0,
        perdidaValor: 0,
      },
    ]);
    expect(reporte.lossByReason).toEqual([
      { reason: 'Merma', quantity: 3, value: 27 },
    ]);
  });

  it('devuelve totales en cero sin inventario ni movimientos', async () => {
    prepararReporte();

    const reporte = await getInventoryReport('store-1', '2026-04-02');

    expect(reporte).toMatchObject({
      storeId: 'store-1',
      date: '2026-04-02',
      hasSnapshot: false,
      totalLossQuantity: 0,
      totalLossValue: 0,
      byProduct: [],
      lossByReason: [],
    });
  });
});
