import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { prismaMock } from '../helpers/prismaMock';
import { dec, inventoryFixture, productFixture, saleFixture, storeFixture } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import { mexicoEndOfDay, mexicoStartOfDay } from '../../src/utils/dates';
import {
  confirmCancellation,
  getEntityDetails,
  listCancellations,
  lookupEntity,
} from '../../src/services/cancel.service';

// ───────────────────────────────────────────────────────────────────────────
// Utilidades locales
// ───────────────────────────────────────────────────────────────────────────

const AHORA = new Date('2026-01-15T18:00:00.000Z');

/** Congela el reloj: la ventana de cancelación se calcula con `new Date()`. */
function fijarAhora(fecha: Date = AHORA): void {
  vi.useFakeTimers();
  vi.setSystemTime(fecha);
}

function haceHoras(horas: number): Date {
  return new Date(AHORA.getTime() - horas * 60 * 60 * 1000);
}

afterEach(() => {
  vi.useRealTimers();
});

// ── Builders locales ───────────────────────────────────────────────────────

interface ItemVentaRow {
  id: string;
  saleId: string;
  productId: string;
  quantity: Prisma.Decimal;
  unidad: string | null;
  unitPrice: Prisma.Decimal;
  costPrice: Prisma.Decimal;
  profit: Prisma.Decimal;
  canceledAt: Date | null;
  canceledBy: string | null;
  cancellationId: string | null;
  product: { name: string };
  lotAssignments: Array<Record<string, unknown>>;
}

function itemVenta(overrides: Partial<ItemVentaRow> = {}): ItemVentaRow {
  return {
    id: 'saleitem-1',
    saleId: 'sale-1',
    productId: 'product-1',
    quantity: dec('2.000'),
    unidad: 'u',
    unitPrice: dec('15.00'),
    costPrice: dec('10.00'),
    profit: dec('10.00'),
    canceledAt: null,
    canceledBy: null,
    cancellationId: null,
    product: { name: 'Refresco 600ml' },
    lotAssignments: [],
    ...overrides,
  };
}

function asignacion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asignacion-1',
    saleItemId: 'saleitem-1',
    lotId: 'lot-1',
    quantity: dec('2.000'),
    restoredQty: dec('0.000'),
    unitCost: dec('10.00'),
    ...overrides,
  };
}

/** Venta tal como la devuelve el `tx.sale.findFirst` de `confirmCancellation`. */
function ventaTransaccion(overrides: Record<string, unknown> = {}) {
  return {
    ...saleFixture({ id: 'sale-1', status: 'COMPLETED', createdAt: AHORA }),
    items: [] as ItemVentaRow[],
    factura: null as { id: string; status: string } | null,
    ...overrides,
  };
}

/** Venta con las relaciones que espera `getEntityDetails`. */
function ventaDetalle(overrides: Record<string, unknown> = {}) {
  return {
    ...saleFixture({ id: 'sale-1', createdAt: AHORA }),
    items: [itemVenta()],
    user: { id: 'user-1', name: 'Vendedor de Prueba' },
    factura: null as { id: string; status: string } | null,
    ...overrides,
  };
}

interface FacturaDetalleRow {
  id: string;
  folio: string;
  storeId: string;
  userId: string;
  total: Prisma.Decimal;
  status: string;
  createdAt: Date;
  sale: { paymentMethod: string; items: ItemVentaRow[] };
  cliente: { nombreRazonSocial: string; rfc: string };
  user: { id: string; name: string };
}

function facturaDetalle(overrides: Partial<FacturaDetalleRow> = {}): FacturaDetalleRow {
  return {
    id: 'factura-1',
    folio: 'STORE001-F0001',
    storeId: 'store-1',
    userId: 'user-1',
    total: dec('116.00'),
    status: 'EMITIDA',
    createdAt: AHORA,
    sale: { paymentMethod: 'CASH', items: [itemVenta()] },
    cliente: { nombreRazonSocial: 'Público en General', rfc: 'XAXX010101000' },
    user: { id: 'user-1', name: 'Vendedor de Prueba' },
    ...overrides,
  };
}

function compraDetalle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stx-1',
    storeId: 'store-1',
    userId: 'user-1',
    supplierId: 'supplier-1',
    status: 'COMPLETED',
    total: dec('20.00'),
    paymentMethod: 'CASH',
    createdAt: AHORA,
    items: [
      {
        id: 'stxitem-1',
        productId: 'product-1',
        quantity: dec('2.000'),
        unitCost: dec('10.00'),
        product: { name: 'Refresco 600ml' },
      },
    ],
    supplier: { id: 'supplier-1', name: 'Distribuidora del Norte' },
    user: { id: 'user-1', name: 'Vendedor de Prueba' },
    ...overrides,
  };
}

const MOTIVO = { id: 'reason-1', storeId: 'store-1', name: 'Error de facturación' };

// ───────────────────────────────────────────────────────────────────────────
// getEntityDetails
// ───────────────────────────────────────────────────────────────────────────

describe('getEntityDetails', () => {
  it('devuelve el detalle de una venta con importes numéricos y subtotal por línea', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(ventaDetalle());

    const resultado = await getEntityDetails('SALE', 'sale-1', 'store-1');

    expect(resultado).toMatchObject({
      entityType: 'SALE',
      entityId: 'sale-1',
      entityNumber: 'STORE001-0001',
      status: 'COMPLETED',
      total: 100,
      saleNumber: 'STORE001-0001',
      paymentMethod: 'CASH',
      userId: 'user-1',
      userName: 'Vendedor de Prueba',
      facturaStatus: null,
      itemCount: 1,
      items: [
        {
          id: 'saleitem-1',
          productName: 'Refresco 600ml',
          quantity: 2,
          unitPrice: 15,
          unidad: 'u',
          subtotal: 30,
        },
      ],
    });
    expect(resultado?.createdAt).toEqual(AHORA);
    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sale-1', storeId: 'store-1' } })
    );
  });

  it('reporta el estado de la factura emitida y omite la unidad nula', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(
      ventaDetalle({
        factura: { id: 'factura-1', status: 'EMITIDA' },
        items: [itemVenta({ unidad: null })],
      })
    );

    const resultado = await getEntityDetails('SALE', 'sale-1', 'store-1');

    expect(resultado?.facturaStatus).toBe('EMITIDA');
    expect(resultado?.items[0].unidad).toBeNull();
  });

  it('devuelve null cuando la venta no existe', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expect(getEntityDetails('SALE', 'sale-404', 'store-1')).resolves.toBeNull();
  });

  it('devuelve el detalle de una factura tomando el método de pago de su venta', async () => {
    prismaMock.factura.findFirst.mockResolvedValue(facturaDetalle());

    const resultado = await getEntityDetails('FACTURA', 'factura-1', 'store-1');

    expect(resultado).toMatchObject({
      entityType: 'FACTURA',
      entityId: 'factura-1',
      entityNumber: 'STORE001-F0001',
      status: 'EMITIDA',
      total: 116,
      paymentMethod: 'CASH',
      itemCount: 1,
    });
    expect(resultado?.items[0].subtotal).toBe(30);
  });

  it('devuelve null cuando la factura no existe', async () => {
    prismaMock.factura.findFirst.mockResolvedValue(null);

    await expect(getEntityDetails('FACTURA', 'factura-404', 'store-1')).resolves.toBeNull();
  });

  it('devuelve el detalle de una compra a proveedor con unitCost por línea', async () => {
    prismaMock.supplierTransaction.findFirst.mockResolvedValue(compraDetalle());

    const resultado = await getEntityDetails('SUPPLIER_TRANSACTION', 'stx-1', 'store-1');

    expect(resultado).toMatchObject({
      entityType: 'SUPPLIER_TRANSACTION',
      entityId: 'stx-1',
      entityNumber: 'stx-1',
      status: 'COMPLETED',
      total: 20,
      supplierId: 'supplier-1',
      supplierName: 'Distribuidora del Norte',
      itemCount: 1,
      items: [
        {
          id: 'stxitem-1',
          productName: 'Refresco 600ml',
          quantity: 2,
          unitCost: 10,
          subtotal: 20,
        },
      ],
    });
  });

  it('devuelve null cuando la compra a proveedor no existe', async () => {
    prismaMock.supplierTransaction.findFirst.mockResolvedValue(null);

    await expect(
      getEntityDetails('SUPPLIER_TRANSACTION', 'stx-404', 'store-1')
    ).resolves.toBeNull();
  });

  it('devuelve null para un tipo de entidad desconocido sin consultar Prisma', async () => {
    await expect(getEntityDetails('OTRO', 'x-1', 'store-1')).resolves.toBeNull();
    expect(prismaMock.sale.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.factura.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.supplierTransaction.findFirst).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// lookupEntity
// ───────────────────────────────────────────────────────────────────────────

describe('lookupEntity', () => {
  it('busca la venta por folio normalizado y devuelve el detalle serializado', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(ventaDetalle());

    const resultado = await lookupEntity('SALE', '  store001-0001  ', 'store-1');

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { saleNumber: 'STORE001-0001', storeId: 'store-1' } })
    );
    expect(resultado).toMatchObject({
      entityType: 'SALE',
      entityNumber: 'STORE001-0001',
      total: 100,
      createdAt: AHORA.toISOString(),
    });
    expect((resultado as { items: unknown[] }).items[0]).toEqual({
      id: 'saleitem-1',
      productName: 'Refresco 600ml',
      quantity: 2,
      unitPrice: 15,
      unitCost: undefined,
      unidad: 'u',
      subtotal: 30,
    });
  });

  it('lanza SALE_NOT_FOUND cuando la venta no existe', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expectApiError(() => lookupEntity('SALE', 'STORE001-9999', 'store-1'), {
      status: 404,
      code: 'SALE_NOT_FOUND',
      message: 'No se encontró una venta con ese número',
    });
  });

  it('busca la factura por folio y devuelve su detalle', async () => {
    prismaMock.factura.findFirst.mockResolvedValue(facturaDetalle());

    const resultado = await lookupEntity('FACTURA', 'store001-f0001', 'store-1');

    expect(prismaMock.factura.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { folio: 'STORE001-F0001', storeId: 'store-1' } })
    );
    expect(resultado).toMatchObject({ entityType: 'FACTURA', total: 116 });
  });

  it('lanza FACTURA_NOT_FOUND cuando la factura no existe', async () => {
    prismaMock.factura.findFirst.mockResolvedValue(null);

    await expectApiError(() => lookupEntity('FACTURA', 'STORE001-F9999', 'store-1'), {
      status: 404,
      code: 'FACTURA_NOT_FOUND',
      message: 'No se encontró una factura con ese folio',
    });
  });

  it('busca la compra a proveedor por su id', async () => {
    prismaMock.supplierTransaction.findFirst.mockResolvedValue(compraDetalle());

    const resultado = await lookupEntity('SUPPLIER_TRANSACTION', 'STX-1', 'store-1');

    expect(prismaMock.supplierTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'STX-1', storeId: 'store-1' } })
    );
    expect(resultado).toMatchObject({ entityType: 'SUPPLIER_TRANSACTION', total: 20 });
  });

  it('lanza SUPPLIER_TX_NOT_FOUND cuando la compra no existe', async () => {
    prismaMock.supplierTransaction.findFirst.mockResolvedValue(null);

    await expectApiError(() => lookupEntity('SUPPLIER_TRANSACTION', 'stx-404', 'store-1'), {
      status: 404,
      code: 'SUPPLIER_TX_NOT_FOUND',
      message: 'No se encontró una compra a proveedor con ese ID',
    });
  });

  it('lanza INVALID_ENTITY_TYPE para un tipo desconocido', async () => {
    await expectApiError(() => lookupEntity('DEVOLUCION', 'X-1', 'store-1'), {
      status: 400,
      code: 'INVALID_ENTITY_TYPE',
      message: 'Tipo de entidad inválido',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// confirmCancellation
// ───────────────────────────────────────────────────────────────────────────

/** Mocks mínimos que toda cancelación consulta antes de abrir la transacción. */
function baseCancelacion(opciones: { store?: unknown; reason?: unknown } = {}) {
  prismaMock.cancellationReason.findFirst.mockResolvedValue(
    opciones.reason === undefined ? MOTIVO : opciones.reason
  );
  prismaMock.store.findUnique.mockResolvedValue(
    opciones.store === undefined ? storeFixture({ id: 'store-1' }) : opciones.store
  );
  // Sin cancelaciones parciales previas por defecto.
  prismaMock.cancellationItem.groupBy.mockResolvedValue([]);
  prismaMock.cancellation.create.mockResolvedValue({
    id: 'cancellation-1',
    type: 'FULL',
    cancellationReason: { id: 'reason-1', name: 'Error de facturación' },
    items: [],
  });
}

function entrada(overrides: Record<string, unknown> = {}) {
  return {
    entityType: 'SALE',
    entityId: 'sale-1',
    storeId: 'store-1',
    userId: 'user-1',
    cancellationReasonId: 'reason-1',
    ...overrides,
  };
}

describe('confirmCancellation', () => {
  it('lanza REASON_NOT_FOUND cuando el motivo no pertenece a la tienda', async () => {
    baseCancelacion({ reason: null });

    await expectApiError(() => confirmCancellation(entrada()), {
      status: 404,
      code: 'REASON_NOT_FOUND',
      message: 'Motivo de cancelación no encontrado',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('exige la sesión de caja en las devoluciones', async () => {
    baseCancelacion();

    await expectApiError(() => confirmCancellation(entrada({ type: 'REFUND' })), {
      status: 400,
      code: 'CAJA_SESSION_REQUIRED',
      message: 'La sesión de caja es requerida para devoluciones',
    });
  });

  it('rechaza una devolución con una sesión de caja cerrada', async () => {
    baseCancelacion();
    prismaMock.cajaSession.findFirst.mockResolvedValue(null);

    await expectApiError(
      () => confirmCancellation(entrada({ type: 'REFUND', cajaSessionId: 'cajasession-1' })),
      {
        status: 400,
        code: 'CAJA_SESSION_INVALID',
        message: 'La sesión de caja no es válida o no está abierta',
      }
    );
  });

  it('lanza SALE_NOT_FOUND cuando la venta no existe', async () => {
    baseCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expectApiError(() => confirmCancellation(entrada()), {
      status: 404,
      code: 'SALE_NOT_FOUND',
      message: 'Venta no encontrada',
    });
  });

  it('lanza ALREADY_CANCELED cuando la venta ya no está completada', async () => {
    baseCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(ventaTransaccion({ status: 'CANCELED' }));

    await expectApiError(() => confirmCancellation(entrada()), {
      status: 400,
      code: 'ALREADY_CANCELED',
      message: 'El documento ya fue cancelado o no está en estado activo',
    });
  });

  it('lanza SALE_HAS_ACTIVE_INVOICE cuando la venta tiene factura emitida', async () => {
    baseCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(
      ventaTransaccion({ factura: { id: 'factura-1', status: 'EMITIDA' } })
    );

    await expectApiError(() => confirmCancellation(entrada()), {
      status: 400,
      code: 'SALE_HAS_ACTIVE_INVOICE',
    });
  });

  it('permite cancelar la venta si su factura ya fue cancelada', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.sale.findFirst
      .mockResolvedValueOnce(
        ventaTransaccion({ factura: { id: 'factura-1', status: 'CANCELED' }, items: [] })
      )
      .mockResolvedValue(ventaDetalle());

    const resultado = await confirmCancellation(entrada());

    expect(resultado).toMatchObject({ id: 'cancellation-1' });
    expect(prismaMock.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sale-1' } })
    );
  });

  it('lanza CANCEL_WINDOW_EXPIRED cuando la cancelación supera las 24 horas', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(
      ventaTransaccion({ createdAt: haceHoras(25) })
    );

    await expectApiError(() => confirmCancellation(entrada()), {
      status: 400,
      code: 'CANCEL_WINDOW_EXPIRED',
      message: /Solo se puede cancelar dentro de las 24 horas posteriores a la operación/,
    });
  });

  it('lanza CANCEL_WINDOW_EXPIRED cuando la devolución supera los días límite de la tienda', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.cajaSession.findFirst.mockResolvedValue({ id: 'cajasession-1' });
    prismaMock.sale.findFirst.mockResolvedValue(
      ventaTransaccion({ createdAt: haceHoras(24 * 8) })
    );

    await expectApiError(
      () =>
        confirmCancellation(
          entrada({ type: 'REFUND', cajaSessionId: 'cajasession-1', items: [{ saleItemId: 'saleitem-1', quantity: 1 }] })
        ),
      {
        status: 400,
        code: 'CANCEL_WINDOW_EXPIRED',
        message: /Solo se puede devolver dentro de los 7 días posteriores a la operación/,
      }
    );
  });

  it('usa 7 días de devolución cuando la tienda no existe', async () => {
    fijarAhora();
    baseCancelacion({ store: null });
    prismaMock.cajaSession.findFirst.mockResolvedValue({ id: 'cajasession-1' });
    prismaMock.sale.findFirst
      .mockResolvedValueOnce(
        ventaTransaccion({ createdAt: haceHoras(24 * 3), items: [itemVenta()] })
      )
      .mockResolvedValue(ventaDetalle());
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue({ id: 'motivo-1' });

    const resultado = await confirmCancellation(
      entrada({
        type: 'REFUND',
        cajaSessionId: 'cajasession-1',
        items: [{ saleItemId: 'saleitem-1', quantity: 1 }],
      })
    );

    expect(resultado).toMatchObject({ id: 'cancellation-1' });
    expect(prismaMock.cancellation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'REFUND' }) })
    );
  });

  it('cancela la venta completa devolviendo inventario y lotes sin duplicar lo ya devuelto', async () => {
    fijarAhora();
    baseCancelacion();
    const itemConLotes = itemVenta({
      id: 'saleitem-1',
      lotAssignments: [asignacion({ id: 'asignacion-1' })],
    });
    const itemSinLotes = itemVenta({
      id: 'saleitem-2',
      productId: 'product-2',
      quantity: dec('1.000'),
    });
    const itemYaDevuelto = itemVenta({
      id: 'saleitem-3',
      productId: 'product-3',
      quantity: dec('3.000'),
      lotAssignments: [
        asignacion({
          id: 'asignacion-3',
          quantity: dec('3.000'),
          restoredQty: dec('3.000'),
        }),
      ],
    });
    prismaMock.sale.findFirst
      .mockResolvedValueOnce(
        ventaTransaccion({ items: [itemConLotes, itemSinLotes, itemYaDevuelto] })
      )
      .mockResolvedValue(ventaDetalle());
    prismaMock.inventoryLot.findFirst.mockResolvedValue({ id: 'lot-1' });

    const resultado = await confirmCancellation(
      entrada({ comment: 'Error de captura' })
    );

    // Solo los dos ítems con saldo pendiente tocan inventario.
    expect(prismaMock.inventory.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.inventory.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { storeId_productId: { storeId: 'store-1', productId: 'product-1' } },
        update: { quantity: { increment: expect.any(Prisma.Decimal) } },
      })
    );
    // Item 1 vuelve a su lote; item 2 al lote genérico más reciente.
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.saleItemLot.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.inventoryLot.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.sale.update).toHaveBeenCalledWith({
      where: { id: 'sale-1' },
      data: {
        status: 'CANCELED',
        canceledAt: expect.any(Date),
        canceledBy: 'user-1',
        cancellationReasonId: 'reason-1',
        cancellationComment: 'Error de captura',
      },
    });
    expect(prismaMock.cancellation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        userId: 'user-1',
        entityType: 'SALE',
        entityId: 'sale-1',
        entityNumber: 'STORE001-0001',
        type: 'FULL',
        cancellationReasonId: 'reason-1',
        comment: 'Error de captura',
        items: undefined,
      }),
      include: { cancellationReason: true, items: true },
    });
    expect(Number(prismaMock.cancellation.create.mock.calls[0][0].data.total)).toBe(100);
    expect(prismaMock.saleItem.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        userId: 'user-1',
        action: 'CANCEL_SALE',
        entity: 'SALE',
        entityId: 'sale-1',
        metadata: expect.objectContaining({
          entityNumber: 'STORE001-0001',
          type: 'FULL',
          cancellationId: 'cancellation-1',
          comment: 'Error de captura',
        }),
      }),
    });
    expect(resultado).toMatchObject({
      id: 'cancellation-1',
      reason: 'Error de facturación',
      entityDetails: expect.objectContaining({ entityId: 'sale-1', total: 100 }),
    });
  });

  it('crea un lote genérico con el residuo que no cupo en las asignaciones', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.sale.findFirst
      .mockResolvedValueOnce(
        ventaTransaccion({
          items: [
            itemVenta({
              quantity: dec('2.000'),
              lotAssignments: [asignacion({ quantity: dec('1.000') })],
            }),
          ],
        })
      )
      // El detalle posterior no se encuentra: entityDetails queda en null.
      .mockResolvedValue(null);
    prismaMock.inventoryLot.findFirst.mockResolvedValue(null);
    prismaMock.product.findUnique.mockResolvedValue(productFixture({ id: 'product-1' }));

    const resultado = await confirmCancellation(entrada());

    expect(prismaMock.inventoryLot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'product-1',
          lotCode: 'DEVOLUCION',
          receivedQty: expect.any(Prisma.Decimal),
        }),
      })
    );
    const creado = prismaMock.inventoryLot.create.mock.calls[0][0].data.receivedQty;
    expect(Number(creado)).toBe(1);
    // Sin comentario el audit log guarda null y entityDetails es null.
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: expect.objectContaining({ comment: null }) }),
      })
    );
    expect(resultado.entityDetails).toBeNull();
    expect(resultado.reason).toBe('Error de facturación');
  });

  it('cancela parcialmente un artículo, acumula lo ya cancelado y vincula los artículos', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.cancellation.create.mockResolvedValue({
      id: 'cancellation-1',
      type: 'PARTIAL',
      cancellationReason: null,
      items: [{ id: 'cancelitem-1' }],
    });
    prismaMock.cancellationItem.groupBy.mockResolvedValue([
      { saleItemId: 'saleitem-1', _sum: { quantity: dec('1.000') } },
    ]);
    prismaMock.sale.findFirst
      .mockResolvedValueOnce(
        ventaTransaccion({ items: [itemVenta({ quantity: dec('3.000') })] })
      )
      .mockResolvedValue(ventaDetalle());
    prismaMock.inventoryLot.findFirst.mockResolvedValue({ id: 'lot-1' });

    const resultado = await confirmCancellation(
      entrada({ items: [{ saleItemId: 'saleitem-1', quantity: 1 }] })
    );

    expect(prismaMock.cancellationItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['saleItemId'], where: { saleItemId: { in: ['saleitem-1'] } } })
    );
    const datos = prismaMock.cancellation.create.mock.calls[0][0].data;
    expect(datos.type).toBe('PARTIAL');
    expect(Number(datos.total)).toBe(15);
    expect(datos.items.create).toEqual([
      expect.objectContaining({
        storeId: 'store-1',
        saleItemId: 'saleitem-1',
        productId: 'product-1',
        productName: 'Refresco 600ml',
        unidad: 'u',
        subtotal: expect.any(Prisma.Decimal),
      }),
    ]);
    // 1 cancelada antes + 1 ahora < 3: el artículo sigue activo.
    expect(prismaMock.saleItem.update).not.toHaveBeenCalled();
    expect(prismaMock.saleItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['saleitem-1'] } },
      data: { cancellationId: 'cancellation-1' },
    });
    // La venta permanece completada.
    expect(prismaMock.sale.update).not.toHaveBeenCalled();
    expect(resultado.reason).toBe('—');
  });

  it('marca el artículo como cancelado cuando se agota su cantidad (suma previa nula)', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.cancellation.create.mockResolvedValue({
      id: 'cancellation-1',
      type: 'PARTIAL',
      cancellationReason: null,
      items: [],
    });
    prismaMock.cancellationItem.groupBy.mockResolvedValue([
      { saleItemId: 'saleitem-1', _sum: { quantity: null } },
    ]);
    prismaMock.sale.findFirst
      .mockResolvedValueOnce(
        ventaTransaccion({ items: [itemVenta({ quantity: dec('2.000') })] })
      )
      .mockResolvedValue(ventaDetalle());
    prismaMock.inventoryLot.findFirst.mockResolvedValue({ id: 'lot-1' });

    await confirmCancellation(
      entrada({ items: [{ saleItemId: 'saleitem-1', quantity: 2 }] })
    );

    expect(prismaMock.saleItem.update).toHaveBeenCalledWith({
      where: { id: 'saleitem-1' },
      data: { canceledAt: expect.any(Date), canceledBy: 'user-1' },
    });
  });

  it('devuelve la cantidad parcial a sus lotes y al lote genérico el residuo', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.sale.findFirst
      .mockResolvedValueOnce(
        ventaTransaccion({
          items: [
            itemVenta({
              quantity: dec('3.000'),
              lotAssignments: [asignacion({ quantity: dec('1.000') })],
            }),
          ],
        })
      )
      .mockResolvedValue(ventaDetalle());
    prismaMock.inventoryLot.findFirst.mockResolvedValue({ id: 'lot-generico' });

    await confirmCancellation(
      entrada({ items: [{ saleItemId: 'saleitem-1', quantity: 2 }] })
    );

    // 1 unidad vuelve al lote original y la otra al lote genérico.
    expect(prismaMock.inventoryLot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lot-1' },
        data: expect.objectContaining({ availableQty: { increment: expect.any(Prisma.Decimal) } }),
      })
    );
    expect(prismaMock.saleItemLot.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.inventoryLot.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lot-generico' } })
    );
  });

  it('lanza INVALID_ITEM cuando el artículo no pertenece a la venta', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(ventaTransaccion({ items: [itemVenta()] }));
    prismaMock.cancellationItem.groupBy.mockResolvedValue([]);

    await expectApiError(
      () => confirmCancellation(entrada({ items: [{ saleItemId: 'otro-item', quantity: 1 }] })),
      { status: 400, code: 'INVALID_ITEM', message: 'Un artículo seleccionado no pertenece a la venta' }
    );
  });

  it('lanza INVALID_QUANTITY cuando la cantidad a cancelar es cero', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(ventaTransaccion({ items: [itemVenta()] }));
    prismaMock.cancellationItem.groupBy.mockResolvedValue([]);

    await expectApiError(
      () => confirmCancellation(entrada({ items: [{ saleItemId: 'saleitem-1', quantity: 0 }] })),
      {
        status: 400,
        code: 'INVALID_QUANTITY',
        message: 'La cantidad a cancelar debe ser mayor a 0',
      }
    );
  });

  it('lanza INSUFFICIENT_TO_CANCEL cuando se pide más de lo disponible', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(
      ventaTransaccion({ items: [itemVenta({ quantity: dec('3.000') })] })
    );
    prismaMock.cancellationItem.groupBy.mockResolvedValue([
      { saleItemId: 'saleitem-1', _sum: { quantity: dec('1.000') } },
    ]);

    await expectApiError(
      () => confirmCancellation(entrada({ items: [{ saleItemId: 'saleitem-1', quantity: 3 }] })),
      {
        status: 400,
        code: 'INSUFFICIENT_TO_CANCEL',
        message: 'Solo quedan 2 disponibles para cancelar de "Refresco 600ml"',
      }
    );
  });

  it('lanza GRANEL_FULL_ONLY cuando un artículo a granel no se cancela completo', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.sale.findFirst.mockResolvedValue(
      ventaTransaccion({ items: [itemVenta({ unidad: 'kg', quantity: dec('2.000') })] })
    );
    prismaMock.cancellationItem.groupBy.mockResolvedValue([]);

    await expectApiError(
      () => confirmCancellation(entrada({ items: [{ saleItemId: 'saleitem-1', quantity: 1 }] })),
      {
        status: 400,
        code: 'GRANEL_FULL_ONLY',
        message: 'El artículo granel "Refresco 600ml" debe cancelarse en su totalidad',
      }
    );
  });

  it('registra el egreso de caja de una devolución reutilizando el motivo existente', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.cajaSession.findFirst.mockResolvedValue({ id: 'cajasession-1' });
    prismaMock.sale.findFirst
      .mockResolvedValueOnce(
        ventaTransaccion({ createdAt: haceHoras(5), items: [itemVenta()] })
      )
      .mockResolvedValue(ventaDetalle());
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue({ id: 'motivo-1' });
    prismaMock.inventoryLot.findFirst.mockResolvedValue({ id: 'lot-1' });

    const resultado = await confirmCancellation(
      entrada({
        type: 'REFUND',
        cajaSessionId: 'cajasession-1',
        items: [{ saleItemId: 'saleitem-1', quantity: 2 }],
      })
    );

    expect(resultado).toMatchObject({ id: 'cancellation-1' });
    expect(prismaMock.cajaMovimientoMotivo.create).not.toHaveBeenCalled();
    expect(prismaMock.cajaMovimiento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        cajaSessionId: 'cajasession-1',
        userId: 'user-1',
        tipo: 'EGRESO',
        metodo: 'CASH',
        motivoId: 'motivo-1',
        motivoTexto: 'Reembolso por devolución - Venta STORE001-0001',
      }),
    });
    expect(Number(prismaMock.cajaMovimiento.create.mock.calls[0][0].data.monto)).toBe(30);
    expect(prismaMock.cancellation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'REFUND' }) })
    );
  });

  it('crea el motivo "Reembolso al cliente" cuando no existe y omite el egreso si el monto es cero', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.cajaSession.findFirst.mockResolvedValue({ id: 'cajasession-1' });
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue(null);
    prismaMock.cajaMovimientoMotivo.create.mockResolvedValue({ id: 'motivo-nuevo' });
    prismaMock.inventoryLot.findFirst.mockResolvedValue({ id: 'lot-1' });

    // unitPrice 0 → total 0: no se crea movimiento de caja.
    prismaMock.sale.findFirst
      .mockResolvedValueOnce(
        ventaTransaccion({ items: [itemVenta({ unitPrice: dec('0.00'), profit: dec('0.00') })] })
      )
      .mockResolvedValue(ventaDetalle());

    await confirmCancellation(
      entrada({
        type: 'REFUND',
        cajaSessionId: 'cajasession-1',
        items: [{ saleItemId: 'saleitem-1', quantity: 1 }],
      })
    );

    expect(prismaMock.cajaMovimiento.create).not.toHaveBeenCalled();
    // Con monto 0 el motivo ni siquiera se consulta.
    expect(prismaMock.cajaMovimientoMotivo.findFirst).not.toHaveBeenCalled();
  });

  it('crea el motivo de reembolso si la tienda no lo tiene dado de alta', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.cajaSession.findFirst.mockResolvedValue({ id: 'cajasession-1' });
    prismaMock.cajaMovimientoMotivo.findFirst.mockResolvedValue(null);
    prismaMock.cajaMovimientoMotivo.create.mockResolvedValue({ id: 'motivo-nuevo' });
    prismaMock.sale.findFirst
      .mockResolvedValueOnce(ventaTransaccion({ createdAt: haceHoras(2), items: [itemVenta()] }))
      .mockResolvedValue(ventaDetalle());
    prismaMock.inventoryLot.findFirst.mockResolvedValue({ id: 'lot-1' });

    await confirmCancellation(
      entrada({
        type: 'REFUND',
        cajaSessionId: 'cajasession-1',
        items: [{ saleItemId: 'saleitem-1', quantity: 1 }],
      })
    );

    expect(prismaMock.cajaMovimientoMotivo.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        name: 'Reembolso al cliente',
        tipo: 'EGRESO',
        isActive: true,
      },
    });
    expect(prismaMock.cajaMovimiento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ motivoId: 'motivo-nuevo' }),
    });
  });

  it('lanza FACTURA_NOT_FOUND cuando la factura no existe', async () => {
    baseCancelacion();
    prismaMock.factura.findFirst.mockResolvedValue(null);

    await expectApiError(
      () => confirmCancellation(entrada({ entityType: 'FACTURA', entityId: 'factura-404' })),
      { status: 404, code: 'FACTURA_NOT_FOUND', message: 'Factura no encontrada' }
    );
  });

  it('lanza ALREADY_CANCELED cuando la factura no está emitida', async () => {
    baseCancelacion();
    prismaMock.factura.findFirst.mockResolvedValue(
      facturaDetalle({ id: 'factura-1', status: 'CANCELED' })
    );

    await expectApiError(
      () => confirmCancellation(entrada({ entityType: 'FACTURA', entityId: 'factura-1' })),
      { status: 400, code: 'ALREADY_CANCELED' }
    );
  });

  it('lanza CANCEL_WINDOW_EXPIRED cuando la factura supera las 72 horas', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.factura.findFirst.mockResolvedValue(
      facturaDetalle({ createdAt: haceHoras(73) })
    );

    await expectApiError(
      () => confirmCancellation(entrada({ entityType: 'FACTURA', entityId: 'factura-1' })),
      {
        status: 400,
        code: 'CANCEL_WINDOW_EXPIRED',
        message: /72 horas/,
      }
    );
  });

  it('cancela una factura emitida dentro de las 72 horas', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.factura.findFirst
      .mockResolvedValueOnce(facturaDetalle({ createdAt: haceHoras(10) }))
      .mockResolvedValue(facturaDetalle());

    const resultado = await confirmCancellation(
      entrada({ entityType: 'FACTURA', entityId: 'factura-1', comment: 'Cliente solicita' })
    );

    expect(prismaMock.factura.update).toHaveBeenCalledWith({
      where: { id: 'factura-1' },
      data: {
        status: 'CANCELED',
        canceledAt: expect.any(Date),
        canceledBy: 'user-1',
        cancellationReasonId: 'reason-1',
        cancellationComment: 'Cliente solicita',
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CANCEL_FACTURA', entity: 'FACTURA' }),
      })
    );
    expect(resultado.entityDetails).toMatchObject({ entityType: 'FACTURA', total: 116 });
  });

  it('lanza SUPPLIER_TX_NOT_FOUND cuando la compra no existe', async () => {
    baseCancelacion();
    prismaMock.supplierTransaction.findFirst.mockResolvedValue(null);

    await expectApiError(
      () =>
        confirmCancellation(
          entrada({ entityType: 'SUPPLIER_TRANSACTION', entityId: 'stx-404' })
        ),
      { status: 404, code: 'SUPPLIER_TX_NOT_FOUND', message: 'Compra a proveedor no encontrada' }
    );
  });

  it('lanza ALREADY_CANCELED cuando la compra ya fue cancelada', async () => {
    baseCancelacion();
    prismaMock.supplierTransaction.findFirst.mockResolvedValue(
      compraDetalle({ status: 'CANCELED' })
    );

    await expectApiError(
      () => confirmCancellation(entrada({ entityType: 'SUPPLIER_TRANSACTION', entityId: 'stx-1' })),
      { status: 400, code: 'ALREADY_CANCELED' }
    );
  });

  it('lanza CANCEL_WINDOW_EXPIRED cuando la compra supera las 24 horas', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.supplierTransaction.findFirst.mockResolvedValue(
      compraDetalle({ createdAt: haceHoras(30) })
    );

    await expectApiError(
      () => confirmCancellation(entrada({ entityType: 'SUPPLIER_TRANSACTION', entityId: 'stx-1' })),
      { status: 400, code: 'CANCEL_WINDOW_EXPIRED' }
    );
  });

  it('cancela una compra a proveedor revirtiendo inventario y lotes', async () => {
    fijarAhora();
    baseCancelacion();
    prismaMock.supplierTransaction.findFirst
      .mockResolvedValueOnce(
        compraDetalle({
          items: [
            {
              id: 'stxitem-1',
              productId: 'product-1',
              quantity: dec('2.000'),
              unitCost: dec('10.00'),
            },
          ],
        })
      )
      .mockResolvedValue(compraDetalle());
    prismaMock.movementReason.findFirst.mockResolvedValue({
      id: 'reason-mov-1',
      name: 'Cancelación de compra',
    });
    prismaMock.product.findFirst.mockResolvedValue(productFixture({ id: 'product-1' }));
    prismaMock.inventory.findUnique.mockResolvedValue(
      inventoryFixture({ quantity: dec('10.000') })
    );
    prismaMock.inventory.findMany.mockResolvedValue([
      { productId: 'product-1', quantity: dec('10.000') },
    ]);
    prismaMock.inventoryLot.count.mockResolvedValue(0);
    prismaMock.inventoryLot.findMany.mockResolvedValue([
      {
        id: 'lot-1',
        productId: 'product-1',
        availableQty: dec('10.000'),
        unitCost: dec('10.00'),
        expirationDate: null,
        lotCode: null,
        createdAt: AHORA,
      },
    ]);
    prismaMock.inventoryLot.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.inventory.update.mockResolvedValue({ quantity: dec('8.000') });
    prismaMock.stockMovement.create.mockResolvedValue({ id: 'mov-1' });

    const resultado = await confirmCancellation(
      entrada({ entityType: 'SUPPLIER_TRANSACTION', entityId: 'stx-1' })
    );

    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipo: 'SALIDA',
          referenceType: 'SUPPLIER_TX',
          referenceId: 'stx-1',
          productId: 'product-1',
        }),
      })
    );
    expect(prismaMock.supplierTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'stx-1' },
        data: expect.objectContaining({ status: 'CANCELED', canceledBy: 'user-1' }),
      })
    );
    expect(Number(prismaMock.cancellation.create.mock.calls[0][0].data.total)).toBe(20);
    expect(resultado.entityDetails).toMatchObject({ entityType: 'SUPPLIER_TRANSACTION' });
  });

  it('lanza INVALID_ENTITY_TYPE para un tipo de entidad no soportado', async () => {
    baseCancelacion();

    await expectApiError(
      () => confirmCancellation(entrada({ entityType: 'DEVOLUCION' })),
      { status: 400, code: 'INVALID_ENTITY_TYPE', message: 'Tipo de entidad inválido' }
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// listCancellations
// ───────────────────────────────────────────────────────────────────────────

describe('listCancellations', () => {
  function filaCancelacion(overrides: Record<string, unknown> = {}) {
    return {
      id: 'cancellation-1',
      storeId: 'store-1',
      userId: 'user-1',
      entityType: 'SALE',
      entityId: 'sale-1',
      entityNumber: 'STORE001-0001',
      total: dec('100.00'),
      type: 'FULL',
      cancellationReasonId: 'reason-1',
      comment: null,
      createdAt: AHORA,
      user: { id: 'user-1', name: 'Vendedor de Prueba', email: 'vendedor@servicaja.com' },
      cancellationReason: null as { name: string } | null,
      items: [],
      ...overrides,
    };
  }

  it('lista las cancelaciones de la tienda sin filtros y tolera motivos/entidades ausentes', async () => {
    prismaMock.cancellation.findMany.mockResolvedValue([
      filaCancelacion({ id: 'cancellation-1' }),
      filaCancelacion({
        id: 'cancellation-2',
        entityType: 'FACTURA',
        entityId: 'factura-1',
        cancellationReason: { name: 'Duplicada' },
      }),
    ]);
    prismaMock.sale.findFirst.mockResolvedValueOnce(null);
    prismaMock.factura.findFirst.mockResolvedValueOnce(facturaDetalle());

    const resultado = await listCancellations('store-1');

    expect(prismaMock.cancellation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 'store-1' },
        orderBy: { createdAt: 'desc' },
      })
    );
    expect(resultado[0].reason).toBe('—');
    expect(resultado[0].entityDetails).toBeNull();
    expect(resultado[1].reason).toBe('Duplicada');
    expect(resultado[1].entityDetails).toMatchObject({ entityType: 'FACTURA', total: 116 });
  });

  it('aplica todos los filtros y el rango de fechas del día de negocio', async () => {
    prismaMock.cancellation.findMany.mockResolvedValue([]);

    await listCancellations('store-1', {
      entityType: 'SALE',
      cancellationReasonId: 'reason-1',
      type: 'PARTIAL',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(prismaMock.cancellation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: 'store-1',
          entityType: 'SALE',
          cancellationReasonId: 'reason-1',
          type: 'PARTIAL',
          createdAt: {
            gte: mexicoStartOfDay('2026-01-01'),
            lte: mexicoEndOfDay('2026-01-31'),
          },
        },
      })
    );
  });

  it('filtra solo por fecha inicial', async () => {
    prismaMock.cancellation.findMany.mockResolvedValue([]);

    await listCancellations('store-1', { startDate: '2026-01-10' });

    expect(prismaMock.cancellation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 'store-1', createdAt: { gte: mexicoStartOfDay('2026-01-10') } },
      })
    );
  });

  it('filtra solo por fecha final', async () => {
    prismaMock.cancellation.findMany.mockResolvedValue([]);

    await listCancellations('store-1', { endDate: '2026-01-20' });

    expect(prismaMock.cancellation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 'store-1', createdAt: { lte: mexicoEndOfDay('2026-01-20') } },
      })
    );
  });
});
