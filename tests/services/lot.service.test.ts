import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { prismaMock } from '../helpers/prismaMock';
import { dec, inventoryFixture, inventoryLotFixture } from '../helpers/fixtures';
import type { InventoryLotRow } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import {
  LOTE_AJUSTE_CODE,
  aDecimal,
  ajustarLotesAInventario,
  aplicarConsumo,
  consumirLotesDeProducto,
  costoPromedioPonderado,
  costoTotalAsignado,
  crearLote,
  diasParaVencer,
  estadoVencimiento,
  inicioDiaUTC,
  listarLotes,
  lotesPorVencer,
  parsearFechaCaducidad,
  planearConsumoFEFO,
  restaurarDeAsignaciones,
  restaurarLoteGenerico,
  restaurarLotes,
  retirarLotesDeCompra,
  serializarLote,
  verificarCuadre,
} from '../../src/services/lot.service';
import type {
  AsignacionLote,
  AsignacionPersistida,
  LoteSerializado,
} from '../../src/services/lot.service';

// ───────────────────────────────────────────────────────────────────────────
// Utilidades locales
// ───────────────────────────────────────────────────────────────────────────

const HOY = new Date('2026-01-15T18:00:00.000Z');

/** Congela el reloj: varias funciones usan `new Date()` como "hoy". */
function fijarHoy(fecha: Date = HOY): void {
  vi.useFakeTimers();
  vi.setSystemTime(fecha);
}

afterEach(() => {
  vi.useRealTimers();
});

interface ProductoLote {
  name: string;
  sku: string | null;
  unidadVenta: string;
}

const PRODUCTO: ProductoLote = { name: 'Refresco 600ml', sku: 'SKU-001', unidadVenta: 'UNIDAD' };

/** Fila de InventoryLot con la relación `product` que devuelve `listarLotes`. */
function loteConProducto(
  overrides: Partial<InventoryLotRow> = {},
  product: ProductoLote | null = PRODUCTO
): InventoryLotRow & { product: ProductoLote | null } {
  return { ...inventoryLotFixture(overrides), product };
}

function asignacion(overrides: Partial<AsignacionLote> = {}): AsignacionLote {
  return {
    lotId: 'lot-1',
    quantity: dec(1),
    unitCost: dec('10.00'),
    expirationDate: null,
    lotCode: null,
    ...overrides,
  };
}

function persistida(overrides: Partial<AsignacionPersistida> = {}): AsignacionPersistida {
  return {
    id: 'sil-1',
    lotId: 'lot-1',
    quantity: dec(2),
    restoredQty: dec(0),
    ...overrides,
  };
}

/** Argumento `data` de la n-ésima llamada a `inventoryLot.create`. */
function dataDeCreacion(indice = 0): any {
  return prismaMock.inventoryLot.create.mock.calls[indice]?.[0]?.data as any;
}

// ───────────────────────────────────────────────────────────────────────────

describe('LOTE_AJUSTE_CODE', () => {
  it('identifica los lotes creados por autocorrección', () => {
    expect(LOTE_AJUSTE_CODE).toBe('AJUSTE');
  });
});

describe('aDecimal', () => {
  it('devuelve cero cuando el valor es null', () => {
    expect(aDecimal(null).toString()).toBe('0');
  });

  it('devuelve cero cuando el valor es undefined', () => {
    expect(aDecimal(undefined).toString()).toBe('0');
  });

  it('devuelve la misma instancia cuando ya es un Decimal', () => {
    const valor = dec('12.500');
    expect(aDecimal(valor)).toBe(valor);
  });

  it('convierte números y cadenas a Decimal', () => {
    expect(aDecimal(2.5).toString()).toBe('2.5');
    expect(aDecimal('7.250').toString()).toBe('7.25');
    expect(aDecimal(0)).toBeInstanceOf(Prisma.Decimal);
  });
});

describe('inicioDiaUTC', () => {
  it('normaliza una fecha con hora a la medianoche UTC', () => {
    expect(inicioDiaUTC(new Date('2026-03-05T23:30:45.123Z'))).toEqual(
      new Date('2026-03-05T00:00:00.000Z')
    );
  });

  it('deja intacta una fecha que ya está a medianoche', () => {
    const fecha = new Date('2026-03-05T00:00:00.000Z');
    expect(inicioDiaUTC(fecha).getTime()).toBe(fecha.getTime());
  });
});

describe('parsearFechaCaducidad', () => {
  it('devuelve null para null y undefined', () => {
    expect(parsearFechaCaducidad(null)).toBeNull();
    expect(parsearFechaCaducidad(undefined)).toBeNull();
  });

  it('normaliza una instancia de Date a medianoche UTC', () => {
    expect(parsearFechaCaducidad(new Date('2026-04-10T18:45:00.000Z'))).toEqual(
      new Date('2026-04-10T00:00:00.000Z')
    );
  });

  it('devuelve null para una Date inválida', () => {
    expect(parsearFechaCaducidad(new Date('no-es-fecha'))).toBeNull();
  });

  it('interpreta el formato YYYY-MM-DD como día UTC exacto', () => {
    expect(parsearFechaCaducidad('2026-02-28')).toEqual(new Date('2026-02-28T00:00:00.000Z'));
    expect(parsearFechaCaducidad('2026-12-31')).toEqual(new Date('2026-12-31T00:00:00.000Z'));
  });

  it('devuelve null para cadenas vacías o en blanco', () => {
    expect(parsearFechaCaducidad('')).toBeNull();
    expect(parsearFechaCaducidad('   ')).toBeNull();
  });

  it('acepta ISO con hora y la recorta al día', () => {
    expect(parsearFechaCaducidad('2026-05-09T22:10:00.000Z')).toEqual(
      new Date('2026-05-09T00:00:00.000Z')
    );
  });

  it('devuelve null cuando el texto no es una fecha válida', () => {
    expect(parsearFechaCaducidad('caduca pronto')).toBeNull();
  });
});

describe('diasParaVencer', () => {
  it('devuelve null cuando el lote no caduca', () => {
    expect(diasParaVencer(null, HOY)).toBeNull();
  });

  it('cuenta los días que faltan', () => {
    expect(diasParaVencer(new Date('2026-01-25T00:00:00.000Z'), HOY)).toBe(10);
  });

  it('devuelve negativo cuando ya caducó', () => {
    expect(diasParaVencer(new Date('2026-01-10T18:00:00.000Z'), HOY)).toBe(-5);
  });

  it('usa la fecha del sistema como hoy por defecto', () => {
    fijarHoy();
    expect(diasParaVencer(new Date('2026-01-16T00:00:00.000Z'))).toBe(1);
  });
});

describe('estadoVencimiento', () => {
  it('sin caducidad devuelve SIN_CADUCIDAD', () => {
    expect(estadoVencimiento(null, HOY)).toBe('SIN_CADUCIDAD');
  });

  it('una fecha pasada devuelve CADUCADO', () => {
    expect(estadoVencimiento(new Date('2026-01-14T00:00:00.000Z'), HOY)).toBe('CADUCADO');
  });

  it('justo en el límite de aviso devuelve POR_VENCER', () => {
    expect(estadoVencimiento(new Date('2026-01-22T00:00:00.000Z'), HOY)).toBe('POR_VENCER');
  });

  it('una fecha lejana devuelve VIGENTE', () => {
    expect(estadoVencimiento(new Date('2026-01-23T00:00:00.000Z'), HOY)).toBe('VIGENTE');
  });

  it('respeta un margen de aviso personalizado', () => {
    const fecha = new Date('2026-01-25T00:00:00.000Z');
    expect(estadoVencimiento(fecha, HOY, 14)).toBe('POR_VENCER');
    expect(estadoVencimiento(fecha, HOY, 3)).toBe('VIGENTE');
  });

  it('usa la fecha del sistema como hoy por defecto', () => {
    fijarHoy();
    expect(estadoVencimiento(new Date('2026-01-20T00:00:00.000Z'))).toBe('POR_VENCER');
  });
});

describe('crearLote', () => {
  it('crea el lote normalizando código, caducidad y costo', async () => {
    const creado = inventoryLotFixture({ id: 'lot-1' });
    prismaMock.inventoryLot.create.mockResolvedValue(creado);

    const resultado = await crearLote(prismaMock as never, {
      storeId: 'store-1',
      productId: 'product-1',
      quantity: 4,
      unitCost: '9.50',
      expirationDate: '2026-03-01',
      lotCode: '  L-01  ',
      supplierTransactionItemId: 'sti-1',
    });

    expect(resultado).toEqual(creado);
    const data = dataDeCreacion();
    expect(data).toMatchObject({
      storeId: 'store-1',
      productId: 'product-1',
      lotCode: 'L-01',
      status: 'ACTIVE',
      supplierTransactionItemId: 'sti-1',
    });
    expect(data.expirationDate).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    expect(String(data.receivedQty)).toBe('4');
    expect(String(data.availableQty)).toBe('4');
    expect(String(data.unitCost)).toBe('9.5');
  });

  it('deja en null el código en blanco, la caducidad ausente y el ítem de compra', async () => {
    prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-2' }));

    await crearLote(prismaMock as never, {
      storeId: 'store-1',
      productId: 'product-1',
      quantity: '1.500',
      unitCost: 3,
      lotCode: '   ',
    });

    const data = dataDeCreacion();
    expect(data.lotCode).toBeNull();
    expect(data.expirationDate).toBeNull();
    expect(data.supplierTransactionItemId).toBeNull();
    expect(String(data.availableQty)).toBe('1.5');
  });

  it('rechaza cantidades en cero', async () => {
    await expectApiError(
      () =>
        crearLote(prismaMock as never, {
          storeId: 'store-1',
          productId: 'product-1',
          quantity: 0,
          unitCost: 10,
        }),
      { status: 400, code: 'INVALID_LOT_QUANTITY' }
    );
    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
  });

  it('rechaza cantidades negativas', async () => {
    await expectApiError(
      () =>
        crearLote(prismaMock as never, {
          storeId: 'store-1',
          productId: 'product-1',
          quantity: '-2',
          unitCost: 10,
        }),
      { status: 400, code: 'INVALID_LOT_QUANTITY' }
    );
  });
});

describe('planearConsumoFEFO', () => {
  function lotesBase() {
    return [
      inventoryLotFixture({
        id: 'lot-a',
        productId: 'product-1',
        lotCode: 'A',
        availableQty: dec(3),
        unitCost: dec('10.00'),
        expirationDate: new Date('2026-02-01T00:00:00.000Z'),
      }),
      inventoryLotFixture({
        id: 'lot-b',
        productId: 'product-1',
        lotCode: 'B',
        availableQty: dec(10),
        unitCost: dec('12.00'),
        expirationDate: null,
      }),
    ];
  }

  it('sin ítems devuelve una lista vacía y no consulta nada', async () => {
    const planes = await planearConsumoFEFO(prismaMock as never, 'store-1', []);

    expect(planes).toEqual([]);
    expect(prismaMock.inventory.findMany).not.toHaveBeenCalled();
    expect(prismaMock.inventoryLot.findMany).not.toHaveBeenCalled();
  });

  it('reparte el consumo de caducidad más próxima a más lejana', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(13) }),
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue(lotesBase());

    const planes = await planearConsumoFEFO(prismaMock as never, 'store-1', [
      { productId: 'product-1', quantity: 5 },
    ]);

    expect(planes).toHaveLength(1);
    expect(planes[0]).toHaveLength(2);
    expect(planes[0][0]).toMatchObject({ lotId: 'lot-a', lotCode: 'A' });
    expect(String(planes[0][0].quantity)).toBe('3');
    expect(planes[0][0].expirationDate).toEqual(new Date('2026-02-01T00:00:00.000Z'));
    expect(planes[0][1]).toMatchObject({ lotId: 'lot-b', lotCode: 'B', expirationDate: null });
    expect(String(planes[0][1].quantity)).toBe('2');
    expect(String(planes[0][1].unitCost)).toBe('12');

    expect(prismaMock.inventory.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', productId: { in: ['product-1'] } },
      select: { productId: true, quantity: true },
    });
    expect(prismaMock.inventoryLot.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', productId: { in: ['product-1'] }, availableQty: { gt: 0 } },
      orderBy: [{ expirationDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
  });

  it('descuenta de un saldo en memoria cuando hay varias líneas del mismo producto', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(13) }),
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue(lotesBase());

    const planes = await planearConsumoFEFO(prismaMock as never, 'store-1', [
      { productId: 'product-1', quantity: 4 },
      { productId: 'product-1', quantity: 9 },
    ]);

    expect(planes).toHaveLength(2);
    expect(String(planes[0][0].quantity)).toBe('3');
    expect(String(planes[0][1].quantity)).toBe('1');
    expect(planes[1]).toHaveLength(1);
    expect(planes[1][0].lotId).toBe('lot-b');
    expect(String(planes[1][0].quantity)).toBe('9');
    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
  });

  it('ignora los lotes sin saldo disponible', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(4) }),
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-vacio', productId: 'product-1', availableQty: dec(0) }),
      inventoryLotFixture({ id: 'lot-lleno', productId: 'product-1', availableQty: dec(4) }),
    ]);

    const planes = await planearConsumoFEFO(prismaMock as never, 'store-1', [
      { productId: 'product-1', quantity: 4 },
    ]);

    expect(planes[0]).toHaveLength(1);
    expect(planes[0][0].lotId).toBe('lot-lleno');
  });

  it('corta el recorrido de lotes en cuanto cubre la cantidad pedida', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(13) }),
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue(lotesBase());

    const planes = await planearConsumoFEFO(prismaMock as never, 'store-1', [
      { productId: 'product-1', quantity: 2 },
    ]);

    expect(planes[0]).toHaveLength(1);
    expect(planes[0][0].lotId).toBe('lot-a');
    expect(String(planes[0][0].quantity)).toBe('2');
  });

  it('lanza INSUFFICIENT_STOCK usando el nombre del producto', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(2) }),
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-a', productId: 'product-1', availableQty: dec(2) }),
    ]);

    await expectApiError(
      () =>
        planearConsumoFEFO(prismaMock as never, 'store-1', [
          { productId: 'product-1', quantity: 5, name: 'Refresco 600ml' },
        ]),
      {
        status: 400,
        code: 'INSUFFICIENT_STOCK',
        message: 'Stock insuficiente para "Refresco 600ml" (faltan 3)',
      }
    );
  });

  it('usa el productId en el mensaje cuando no hay nombre', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);

    await expectApiError(
      () =>
        planearConsumoFEFO(prismaMock as never, 'store-1', [
          { productId: 'product-9', quantity: 1 },
        ]),
      {
        status: 400,
        code: 'INSUFFICIENT_STOCK',
        message: 'Stock insuficiente para "product-9" (faltan 1)',
      }
    );
    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
  });

  it('crea un lote de ajuste auditado cuando el inventario no tiene respaldo', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(10) }),
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-a', productId: 'product-1', availableQty: dec(4) }),
    ]);
    prismaMock.product.findUnique.mockResolvedValue({
      name: 'Refresco 600ml',
      costPrice: dec('12.50'),
    });
    prismaMock.inventoryLot.create.mockResolvedValue(
      inventoryLotFixture({
        id: 'lot-ajuste',
        productId: 'product-1',
        lotCode: LOTE_AJUSTE_CODE,
        receivedQty: dec(6),
        availableQty: dec(6),
        unitCost: dec('12.50'),
      })
    );
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const planes = await planearConsumoFEFO(prismaMock as never, 'store-1', [
      { productId: 'product-1', quantity: 10 },
    ]);

    expect(prismaMock.product.findUnique).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      select: { name: true, costPrice: true },
    });
    const data = dataDeCreacion();
    expect(data.lotCode).toBe(LOTE_AJUSTE_CODE);
    expect(String(data.receivedQty)).toBe('6');
    expect(String(data.unitCost)).toBe('12.5');
    expect(data.expirationDate).toBeNull();

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        action: 'LOTE_AJUSTE',
        entity: 'InventoryLot',
        entityId: 'lot-ajuste',
        metadata: {
          productId: 'product-1',
          productName: 'Refresco 600ml',
          quantity: 6,
          motivo: 'Inventario sin lote que lo respalde; se creó un lote de ajuste',
        },
      },
    });

    expect(planes[0]).toHaveLength(2);
    expect(planes[0][0].lotId).toBe('lot-a');
    expect(planes[0][1].lotId).toBe('lot-ajuste');
    expect(String(planes[0][1].quantity)).toBe('6');
    expect(String(planes[0][1].unitCost)).toBe('12.5');
  });

  it('usa costo cero y nombre nulo cuando el producto del ajuste no existe', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(3) }),
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);
    prismaMock.product.findUnique.mockResolvedValue(null);
    prismaMock.inventoryLot.create.mockResolvedValue(
      inventoryLotFixture({ id: 'lot-ajuste', productId: 'product-1', availableQty: dec(3) })
    );
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const planes = await planearConsumoFEFO(prismaMock as never, 'store-1', [
      { productId: 'product-1', quantity: 3, name: 'Fantasma' },
    ]);

    expect(String(dataDeCreacion().unitCost)).toBe('0');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ productName: null, quantity: 3 }),
        }),
      })
    );
    expect(planes[0][0].lotId).toBe('lot-ajuste');
  });

  it('no ajusta cuando el inventario ya coincide con la suma de lotes', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(4) }),
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-a', productId: 'product-1', availableQty: dec(4) }),
    ]);

    await planearConsumoFEFO(prismaMock as never, 'store-1', [
      { productId: 'product-1', quantity: 1 },
    ]);

    expect(prismaMock.product.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('no ajusta cuando el inventario tiene menos saldo que los lotes', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(1) }),
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-a', productId: 'product-1', availableQty: dec(4) }),
    ]);

    await planearConsumoFEFO(prismaMock as never, 'store-1', [
      { productId: 'product-1', quantity: 1 },
    ]);

    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
  });
});

describe('costoPromedioPonderado', () => {
  it('pondera el costo por las cantidades de cada lote', () => {
    const promedio = costoPromedioPonderado([
      asignacion({ quantity: dec(2), unitCost: dec('10.00') }),
      asignacion({ quantity: dec(3), unitCost: dec('20.00') }),
    ]);

    expect(promedio.toString()).toBe('16');
  });

  it('redondea a dos decimales', () => {
    const promedio = costoPromedioPonderado([
      asignacion({ quantity: dec(1), unitCost: dec('10.00') }),
      asignacion({ quantity: dec(2), unitCost: dec('11.11') }),
    ]);

    expect(promedio.toFixed(2)).toBe('10.74');
  });

  it('devuelve cero sin asignaciones', () => {
    expect(costoPromedioPonderado([]).toString()).toBe('0');
  });

  it('devuelve cero cuando la cantidad total es cero', () => {
    const promedio = costoPromedioPonderado([
      asignacion({ quantity: dec(0), unitCost: dec('10.00') }),
    ]);

    expect(promedio.toString()).toBe('0');
  });
});

describe('costoTotalAsignado', () => {
  it('suma cantidad por costo de cada asignación', () => {
    const total = costoTotalAsignado([
      asignacion({ quantity: dec(2), unitCost: dec('10.00') }),
      asignacion({ quantity: dec(3), unitCost: dec('20.00') }),
    ]);

    expect(total.toString()).toBe('80');
  });

  it('devuelve cero sin asignaciones', () => {
    expect(costoTotalAsignado([]).toString()).toBe('0');
  });
});

describe('aplicarConsumo', () => {
  it('descuenta los lotes y registra la trazabilidad en SaleItemLot', async () => {
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.saleItemLot.create.mockResolvedValue({ id: 'sil-1' });

    await aplicarConsumo(prismaMock as never, 'saleitem-1', [
      asignacion({ lotId: 'lot-a', quantity: dec(2), unitCost: dec('10.00') }),
    ]);

    expect(prismaMock.inventoryLot.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'lot-a', availableQty: { gte: dec(2) } },
      data: { availableQty: { decrement: dec(2) } },
    });
    expect(prismaMock.saleItemLot.create).toHaveBeenCalledWith({
      data: {
        saleItemId: 'saleitem-1',
        lotId: 'lot-a',
        quantity: dec(2),
        unitCost: dec('10.00'),
      },
    });
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'lot-a', availableQty: { lte: 0 } },
      data: { status: 'DEPLETED' },
    });
  });

  it('omite las asignaciones con cantidad cero o negativa', async () => {
    await aplicarConsumo(prismaMock as never, 'saleitem-1', [
      asignacion({ quantity: dec(0) }),
      asignacion({ quantity: dec(-1) }),
    ]);

    expect(prismaMock.inventoryLot.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.saleItemLot.create).not.toHaveBeenCalled();
  });

  it('lanza INSUFFICIENT_STOCK si el lote cambió mientras se registraba', async () => {
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 0 });

    await expectApiError(
      () => aplicarConsumo(prismaMock as never, 'saleitem-1', [asignacion()]),
      {
        status: 400,
        code: 'INSUFFICIENT_STOCK',
        message: 'El inventario cambió mientras se registraba la operación. Vuelve a intentarlo.',
      }
    );
    expect(prismaMock.saleItemLot.create).not.toHaveBeenCalled();
  });
});

describe('consumirLotesDeProducto', () => {
  it('descuenta por FEFO sin crear SaleItemLot', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(10) }),
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-a', productId: 'product-1', availableQty: dec(10) }),
    ]);
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });

    const asignaciones = await consumirLotesDeProducto(
      prismaMock as never,
      'store-1',
      'product-1',
      4
    );

    expect(asignaciones).toHaveLength(1);
    expect(asignaciones[0].lotId).toBe('lot-a');
    expect(String(asignaciones[0].quantity)).toBe('4');
    expect(prismaMock.saleItemLot.create).not.toHaveBeenCalled();
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'lot-a', availableQty: { gte: dec(4) } },
      data: { availableQty: { decrement: dec(4) } },
    });
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'lot-a', availableQty: { lte: 0 } },
      data: { status: 'DEPLETED' },
    });
  });

  it('propaga INSUFFICIENT_STOCK si el saldo del lote ya no alcanza', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(10) }),
    ]);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-a', productId: 'product-1', availableQty: dec(10) }),
    ]);
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 0 });

    await expectApiError(
      () => consumirLotesDeProducto(prismaMock as never, 'store-1', 'product-1', 2, 'Refresco'),
      { status: 400, code: 'INSUFFICIENT_STOCK' }
    );
  });
});

describe('ajustarLotesAInventario', () => {
  it('crea un lote de ajuste con el costo del producto cuando falta respaldo', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([{ availableQty: dec(4) }]);
    prismaMock.product.findUnique.mockResolvedValue({ costPrice: dec('8.00') });
    prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-ajuste' }));

    await ajustarLotesAInventario(prismaMock as never, 'store-1', 'product-1', 10);

    expect(prismaMock.product.findUnique).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      select: { costPrice: true },
    });
    const data = dataDeCreacion();
    expect(String(data.receivedQty)).toBe('6');
    expect(String(data.unitCost)).toBe('8');
    expect(data.lotCode).toBe(LOTE_AJUSTE_CODE);
    expect(data.expirationDate).toBeNull();
  });

  it('respeta el costo y la caducidad indicados explícitamente', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);
    prismaMock.product.findUnique.mockResolvedValue({ costPrice: dec('8.00') });
    prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-ajuste' }));

    await ajustarLotesAInventario(
      prismaMock as never,
      'store-1',
      'product-1',
      2,
      '5.75',
      '2026-06-30'
    );

    const data = dataDeCreacion();
    expect(String(data.unitCost)).toBe('5.75');
    expect(data.expirationDate).toEqual(new Date('2026-06-30T00:00:00.000Z'));
  });

  it('usa costo cero cuando el producto ya no existe', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);
    prismaMock.product.findUnique.mockResolvedValue(null);
    prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-ajuste' }));

    await ajustarLotesAInventario(prismaMock as never, 'store-1', 'product-1', 1);

    expect(String(dataDeCreacion().unitCost)).toBe('0');
  });

  it('consume por FEFO cuando los lotes exceden el total objetivo', async () => {
    // 1ª consulta: sólo el saldo (ajustarLotesAInventario); 2ª: los lotes completos (FEFO).
    prismaMock.inventoryLot.findMany
      .mockResolvedValueOnce([{ availableQty: dec(10) }])
      .mockResolvedValueOnce([
        inventoryLotFixture({ id: 'lot-a', productId: 'product-1', availableQty: dec(10) }),
      ]);
    prismaMock.inventory.findMany.mockResolvedValue([
      inventoryFixture({ productId: 'product-1', quantity: dec(2) }),
    ]);
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });

    await ajustarLotesAInventario(prismaMock as never, 'store-1', 'product-1', 2);

    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'lot-a', availableQty: { gte: dec(8) } },
      data: { availableQty: { decrement: dec(8) } },
    });
  });

  it('no hace nada cuando el total ya cuadra', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      { availableQty: dec(5) },
      { availableQty: dec('2.5') },
    ]);

    await ajustarLotesAInventario(prismaMock as never, 'store-1', 'product-1', '7.5');

    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
    expect(prismaMock.inventoryLot.updateMany).not.toHaveBeenCalled();
  });
});

describe('restaurarLotes', () => {
  it('devuelve las cantidades a sus lotes y los reactiva', async () => {
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });

    await restaurarLotes(prismaMock as never, [
      { lotId: 'lot-a', quantity: '2.5' },
      { lotId: 'lot-b', quantity: 1 },
    ]);

    expect(prismaMock.inventoryLot.updateMany).toHaveBeenCalledTimes(2);
    const primera = prismaMock.inventoryLot.updateMany.mock.calls[0]?.[0] as any;
    expect(primera.where).toEqual({ id: 'lot-a' });
    expect(primera.data.status).toBe('ACTIVE');
    expect(String(primera.data.availableQty.increment)).toBe('2.5');
  });

  it('ignora las cantidades cero o negativas', async () => {
    await restaurarLotes(prismaMock as never, [
      { lotId: 'lot-a', quantity: 0 },
      { lotId: 'lot-b', quantity: -3 },
    ]);

    expect(prismaMock.inventoryLot.updateMany).not.toHaveBeenCalled();
  });
});

describe('restaurarDeAsignaciones', () => {
  it('reparte la devolución y corta cuando se agota la cantidad', async () => {
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.saleItemLot.update.mockResolvedValue({ id: 'sil-1' });

    const restante = await restaurarDeAsignaciones(
      prismaMock as never,
      [
        persistida({ id: 'sil-1', lotId: 'lot-a', quantity: dec(3), restoredQty: dec(1) }),
        persistida({ id: 'sil-2', lotId: 'lot-b', quantity: dec(2), restoredQty: dec(2) }),
        persistida({ id: 'sil-3', lotId: 'lot-c', quantity: dec(4), restoredQty: dec(0) }),
        persistida({ id: 'sil-4', lotId: 'lot-d', quantity: dec(4), restoredQty: dec(0) }),
      ],
      5
    );

    expect(restante.toString()).toBe('0');
    // sil-1 devuelve 2 (pendiente), sil-2 se omite por estar ya devuelto,
    // sil-3 devuelve 3 (lo que resta) y sil-4 no se toca.
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.saleItemLot.update).toHaveBeenCalledTimes(2);

    const primera = prismaMock.inventoryLot.updateMany.mock.calls[0]?.[0] as any;
    expect(primera.where).toEqual({ id: 'lot-a' });
    expect(primera.data.status).toBe('ACTIVE');
    expect(String(primera.data.availableQty.increment)).toBe('2');

    const segunda = prismaMock.inventoryLot.updateMany.mock.calls[1]?.[0] as any;
    expect(segunda.where).toEqual({ id: 'lot-c' });
    expect(String(segunda.data.availableQty.increment)).toBe('3');

    expect(prismaMock.saleItemLot.update).toHaveBeenCalledWith({
      where: { id: 'sil-1' },
      data: { restoredQty: { increment: dec(2) } },
    });
  });

  it('devuelve el residuo cuando las asignaciones no alcanzan', async () => {
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.saleItemLot.update.mockResolvedValue({ id: 'sil-1' });

    const restante = await restaurarDeAsignaciones(
      prismaMock as never,
      [persistida({ quantity: dec(1), restoredQty: dec(0) })],
      '3'
    );

    expect(restante.toString()).toBe('2');
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenCalledTimes(1);
  });

  it('no toca nada cuando la cantidad a devolver es cero', async () => {
    const restante = await restaurarDeAsignaciones(
      prismaMock as never,
      [persistida()],
      0
    );

    expect(restante.toString()).toBe('0');
    expect(prismaMock.inventoryLot.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.saleItemLot.update).not.toHaveBeenCalled();
  });
});

describe('restaurarLoteGenerico', () => {
  it('reutiliza el lote más reciente del producto', async () => {
    prismaMock.inventoryLot.findFirst.mockResolvedValue(inventoryLotFixture({ id: 'lot-nuevo' }));
    prismaMock.inventoryLot.update.mockResolvedValue({ id: 'lot-nuevo' });

    await restaurarLoteGenerico(prismaMock as never, 'store-1', 'product-1', 2);

    expect(prismaMock.inventoryLot.findFirst).toHaveBeenCalledWith({
      where: { storeId: 'store-1', productId: 'product-1' },
      orderBy: { createdAt: 'desc' },
    });
    const llamada = prismaMock.inventoryLot.update.mock.calls[0]?.[0] as any;
    expect(llamada.where).toEqual({ id: 'lot-nuevo' });
    expect(llamada.data.status).toBe('ACTIVE');
    expect(String(llamada.data.availableQty.increment)).toBe('2');
    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
  });

  it('crea un lote DEVOLUCION con el costo del producto si no hay lotes', async () => {
    prismaMock.inventoryLot.findFirst.mockResolvedValue(null);
    prismaMock.product.findUnique.mockResolvedValue({ costPrice: dec('7.25') });
    prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-dev' }));

    await restaurarLoteGenerico(prismaMock as never, 'store-1', 'product-1', 3);

    const data = dataDeCreacion();
    expect(data.lotCode).toBe('DEVOLUCION');
    expect(data.expirationDate).toBeNull();
    expect(String(data.receivedQty)).toBe('3');
    expect(String(data.unitCost)).toBe('7.25');
  });

  it('crea el lote genérico con costo cero si el producto no existe', async () => {
    prismaMock.inventoryLot.findFirst.mockResolvedValue(null);
    prismaMock.product.findUnique.mockResolvedValue(null);
    prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-dev' }));

    await restaurarLoteGenerico(prismaMock as never, 'store-1', 'product-1', 1);

    expect(String(dataDeCreacion().unitCost)).toBe('0');
  });

  it('usa el costo indicado explícitamente', async () => {
    prismaMock.inventoryLot.findFirst.mockResolvedValue(null);
    prismaMock.product.findUnique.mockResolvedValue({ costPrice: dec('7.25') });
    prismaMock.inventoryLot.create.mockResolvedValue(inventoryLotFixture({ id: 'lot-dev' }));

    await restaurarLoteGenerico(prismaMock as never, 'store-1', 'product-1', 1, '4.40');

    expect(String(dataDeCreacion().unitCost)).toBe('4.4');
  });

  it('no hace nada cuando la cantidad es cero o negativa', async () => {
    await restaurarLoteGenerico(prismaMock as never, 'store-1', 'product-1', 0);
    await restaurarLoteGenerico(prismaMock as never, 'store-1', 'product-1', -2);

    expect(prismaMock.inventoryLot.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.inventoryLot.create).not.toHaveBeenCalled();
  });
});

describe('retirarLotesDeCompra', () => {
  it('devuelve cero sin consultar lotes cuando la cantidad no es positiva', async () => {
    const restante = await retirarLotesDeCompra(prismaMock as never, 'sti-1', 0);

    expect(restante.toString()).toBe('0');
    expect(prismaMock.inventoryLot.findMany).not.toHaveBeenCalled();
    expect(prismaMock.inventoryLot.update).not.toHaveBeenCalled();
  });

  it('retira en orden FEFO y marca DEPLETED sólo el lote agotado', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-a', availableQty: dec(5) }),
      inventoryLotFixture({ id: 'lot-b', availableQty: dec(5) }),
      inventoryLotFixture({ id: 'lot-c', availableQty: dec(5) }),
    ]);
    prismaMock.inventoryLot.update.mockResolvedValue({ id: 'lot-a' });

    const restante = await retirarLotesDeCompra(prismaMock as never, 'sti-1', 7);

    expect(restante.toString()).toBe('0');
    expect(prismaMock.inventoryLot.findMany).toHaveBeenCalledWith({
      where: { supplierTransactionItemId: 'sti-1', availableQty: { gt: 0 } },
      orderBy: [{ expirationDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    expect(prismaMock.inventoryLot.update).toHaveBeenCalledTimes(2);

    const primera = prismaMock.inventoryLot.update.mock.calls[0]?.[0] as any;
    expect(primera.where).toEqual({ id: 'lot-a' });
    expect(String(primera.data.availableQty.decrement)).toBe('5');
    expect(primera.data.status).toBe('DEPLETED');

    const segunda = prismaMock.inventoryLot.update.mock.calls[1]?.[0] as any;
    expect(segunda.where).toEqual({ id: 'lot-b' });
    expect(String(segunda.data.availableQty.decrement)).toBe('2');
    expect(segunda.data).not.toHaveProperty('status');
  });

  it('ignora los lotes sin saldo disponible', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-vacio', availableQty: dec(0) }),
      inventoryLotFixture({ id: 'lot-a', availableQty: dec(10) }),
    ]);
    prismaMock.inventoryLot.update.mockResolvedValue({ id: 'lot-a' });

    const restante = await retirarLotesDeCompra(prismaMock as never, 'sti-1', 3);

    expect(restante.toString()).toBe('0');
    expect(prismaMock.inventoryLot.update).toHaveBeenCalledTimes(1);
    const llamada = prismaMock.inventoryLot.update.mock.calls[0]?.[0] as any;
    expect(llamada.where).toEqual({ id: 'lot-a' });
  });

  it('devuelve lo que no se pudo retirar porque ya se vendió', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      inventoryLotFixture({ id: 'lot-a', availableQty: dec(2) }),
    ]);
    prismaMock.inventoryLot.update.mockResolvedValue({ id: 'lot-a' });

    const restante = await retirarLotesDeCompra(prismaMock as never, 'sti-1', 5);

    expect(restante.toString()).toBe('3');
    const llamada = prismaMock.inventoryLot.update.mock.calls[0]?.[0] as any;
    expect(llamada.data.status).toBe('DEPLETED');
  });

  it('devuelve toda la cantidad cuando la compra no tiene lotes', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);

    const restante = await retirarLotesDeCompra(prismaMock as never, 'sti-1', '2.5');

    expect(restante.toString()).toBe('2.5');
    expect(prismaMock.inventoryLot.update).not.toHaveBeenCalled();
  });
});

describe('serializarLote', () => {
  it('convierte el lote con producto y caducidad cercana', () => {
    fijarHoy();

    const serializado: LoteSerializado = serializarLote(
      loteConProducto({
        id: 'lot-1',
        productId: 'product-1',
        lotCode: 'L-01',
        expirationDate: new Date('2026-01-20T00:00:00.000Z'),
        receivedQty: dec('10.000'),
        availableQty: dec('4.000'),
        unitCost: dec('12.50'),
        status: 'ACTIVE',
        supplierTransactionItemId: 'sti-1',
        createdAt: new Date('2026-01-02T09:30:00.000Z'),
      })
    );

    expect(serializado).toEqual({
      id: 'lot-1',
      productId: 'product-1',
      productName: 'Refresco 600ml',
      sku: 'SKU-001',
      unidadVenta: 'UNIDAD',
      lotCode: 'L-01',
      expirationDate: '2026-01-20',
      diasParaVencer: 5,
      estado: 'POR_VENCER',
      receivedQty: 10,
      availableQty: 4,
      unitCost: 12.5,
      valorDisponible: 50,
      status: 'ACTIVE',
      supplierTransactionItemId: 'sti-1',
      createdAt: '2026-01-02T09:30:00.000Z',
    });
  });

  it('deja en null los datos del producto y la caducidad ausentes', () => {
    fijarHoy();

    const serializado = serializarLote(
      loteConProducto({ id: 'lot-2', availableQty: dec(0) }, null)
    );

    expect(serializado).toMatchObject({
      productName: null,
      sku: null,
      unidadVenta: null,
      expirationDate: null,
      diasParaVencer: null,
      estado: 'SIN_CADUCIDAD',
      availableQty: 0,
      valorDisponible: 0,
    });
  });

  it('marca CADUCADO y respeta el margen de aviso recibido', () => {
    fijarHoy();

    const caducado = serializarLote(
      loteConProducto({ expirationDate: new Date('2026-01-10T00:00:00.000Z') })
    );
    expect(caducado.estado).toBe('CADUCADO');
    expect(caducado.diasParaVencer).toBe(-5);

    const lejano = serializarLote(
      loteConProducto({ expirationDate: new Date('2026-01-25T00:00:00.000Z') }),
      14
    );
    expect(lejano.estado).toBe('POR_VENCER');

    const vigente = serializarLote(
      loteConProducto({ expirationDate: new Date('2026-01-25T00:00:00.000Z') })
    );
    expect(vigente.estado).toBe('VIGENTE');
  });
});

describe('listarLotes', () => {
  it('sin paginación devuelve los lotes serializados', async () => {
    fijarHoy();
    prismaMock.inventoryLot.findMany.mockResolvedValue([loteConProducto({ id: 'lot-1' })]);

    const resultado = await listarLotes('store-1');

    expect(prismaMock.inventoryLot.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      include: { product: { select: { name: true, sku: true, unidadVenta: true } } },
      orderBy: [{ expirationDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    expect(resultado).toEqual({
      lots: [expect.objectContaining({ id: 'lot-1', productName: 'Refresco 600ml' })],
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('aplica los filtros de producto, saldo y búsqueda', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);

    await listarLotes('store-1', { productId: 'product-1', conSaldo: true, search: 'refresco' });

    const where = (prismaMock.inventoryLot.findMany.mock.calls[0]?.[0] as any).where;
    expect(where).toEqual({
      storeId: 'store-1',
      productId: 'product-1',
      availableQty: { gt: 0 },
      product: { name: { contains: 'refresco', mode: 'insensitive' } },
    });
  });

  it('filtra por caducidad dentro de N días', async () => {
    fijarHoy();
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);

    await listarLotes('store-1', { venceEnDias: 10 });

    const where = (prismaMock.inventoryLot.findMany.mock.calls[0]?.[0] as any).where;
    expect(where.expirationDate).toEqual({
      not: null,
      lte: new Date('2026-01-25T00:00:00.000Z'),
    });
  });

  it('filtra los caducados con la fecha de hoy', async () => {
    fijarHoy();
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);

    await listarLotes('store-1', { vencimiento: 'CADUCADO' });

    const where = (prismaMock.inventoryLot.findMany.mock.calls[0]?.[0] as any).where;
    expect(where.expirationDate).toEqual({ not: null, lt: new Date('2026-01-15T00:00:00.000Z') });
  });

  it('filtra los próximos a vencer usando el margen de aviso', async () => {
    fijarHoy();
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);

    await listarLotes('store-1', { vencimiento: 'POR_VENCER', diasAviso: 3 });

    const where = (prismaMock.inventoryLot.findMany.mock.calls[0]?.[0] as any).where;
    expect(where.expirationDate).toEqual({
      not: null,
      gte: new Date('2026-01-15T00:00:00.000Z'),
      lte: new Date('2026-01-18T00:00:00.000Z'),
    });
  });

  it('filtra los lotes sin caducidad', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);

    await listarLotes('store-1', { vencimiento: 'SIN_CADUCIDAD' });

    const where = (prismaMock.inventoryLot.findMany.mock.calls[0]?.[0] as any).where;
    expect(where.expirationDate).toBeNull();
  });

  it('no filtra por caducidad cuando el vencimiento es TODOS', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);

    await listarLotes('store-1', { vencimiento: 'TODOS' });

    const where = (prismaMock.inventoryLot.findMany.mock.calls[0]?.[0] as any).where;
    expect(where).toEqual({ storeId: 'store-1' });
    expect(where).not.toHaveProperty('expirationDate');
  });

  it('con paginación devuelve total y totalPages', async () => {
    fijarHoy();
    prismaMock.inventoryLot.findMany.mockResolvedValue([loteConProducto({ id: 'lot-1' })]);
    prismaMock.inventoryLot.count.mockResolvedValue(25);

    const resultado = await listarLotes('store-1', { page: 2, limit: 10 });

    const args = prismaMock.inventoryLot.findMany.mock.calls[0]?.[0] as any;
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(prismaMock.inventoryLot.count).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
    });
    expect(resultado).toMatchObject({
      total: 25,
      page: 2,
      limit: 10,
      totalPages: 3,
      lots: [expect.objectContaining({ id: 'lot-1' })],
    });
  });

  it('usa límite 50 y una página cuando no hay resultados', async () => {
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);
    prismaMock.inventoryLot.count.mockResolvedValue(0);

    const resultado = await listarLotes('store-1', { page: 1 });

    expect(resultado).toEqual({ lots: [], total: 0, page: 1, limit: 50, totalPages: 1 });
  });
});

describe('lotesPorVencer', () => {
  it('separa caducados y por vencer y suma el valor en riesgo', async () => {
    fijarHoy();
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      loteConProducto({
        id: 'lot-caducado',
        expirationDate: new Date('2026-01-10T00:00:00.000Z'),
        availableQty: dec(2),
        unitCost: dec('10.00'),
      }),
      loteConProducto({
        id: 'lot-por-vencer',
        expirationDate: new Date('2026-01-18T00:00:00.000Z'),
        availableQty: dec(1),
        unitCost: dec('5.00'),
      }),
      loteConProducto({
        id: 'lot-vigente',
        expirationDate: new Date('2026-03-01T00:00:00.000Z'),
        availableQty: dec(1),
        unitCost: dec('2.00'),
      }),
    ]);

    const resultado = await lotesPorVencer('store-1');

    expect(prismaMock.inventoryLot.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 'store-1',
        availableQty: { gt: 0 },
        expirationDate: { not: null, lte: new Date('2026-01-22T00:00:00.000Z') },
      },
      include: { product: { select: { name: true, sku: true, unidadVenta: true } } },
      orderBy: [{ expirationDate: 'asc' }, { createdAt: 'asc' }],
    });
    expect(resultado.dias).toBe(7);
    expect(resultado.lots).toHaveLength(3);
    expect(resultado.caducados.map((l) => l.id)).toEqual(['lot-caducado']);
    expect(resultado.porVencer.map((l) => l.id)).toEqual(['lot-por-vencer']);
    expect(resultado.valorEnRiesgo).toBeCloseTo(27);
  });

  it('acepta un margen de días personalizado y sin lotes devuelve todo vacío', async () => {
    fijarHoy();
    prismaMock.inventoryLot.findMany.mockResolvedValue([]);

    const resultado = await lotesPorVencer('store-1', 30);

    expect(resultado).toEqual({ dias: 30, lots: [], caducados: [], porVencer: [], valorEnRiesgo: 0 });
    const where = (prismaMock.inventoryLot.findMany.mock.calls[0]?.[0] as any).where;
    expect(where.expirationDate.lte).toEqual(new Date('2026-02-14T00:00:00.000Z'));
  });
});

describe('verificarCuadre', () => {
  it('convierte los strings de la consulta a números', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        productId: 'product-1',
        productName: 'Refresco 600ml',
        inventario: '10.000',
        lotes: '9.000',
        diferencia: '1.000',
      },
    ]);

    const filas = await verificarCuadre('store-1');

    expect(filas).toEqual([
      {
        productId: 'product-1',
        productName: 'Refresco 600ml',
        inventario: 10,
        lotes: 9,
        diferencia: 1,
      },
    ]);
    expect(prismaMock.$queryRaw.mock.calls[0]?.[1]).toBe('store-1');
  });

  it('devuelve una lista vacía cuando todo cuadra', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    const filas = await verificarCuadre('store-1');

    expect(filas).toEqual([]);
  });
});
