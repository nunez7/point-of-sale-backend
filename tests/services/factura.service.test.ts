import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { clienteFixture, dec, saleFixture, storeFixture } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import { mexicoEndOfDay, mexicoStartOfDay } from '../../src/utils/dates';
import {
  buscarVentaPorNumero,
  cancelarFactura,
  emitirFactura,
  listarFacturas,
  obtenerFactura,
} from '../../src/services/factura.service';

const FECHA = new Date('2026-01-15T18:00:00.000Z');

// La Factura no tiene builder en tests/helpers/fixtures.ts, así que se define
// localmente con la forma que devuelve Prisma (Decimal real, no números).
interface FacturaRow {
  id: string;
  folio: string;
  storeId: string;
  saleId: string;
  clienteId: string;
  userId: string;
  emisorRfc: string;
  emisorNombre: string;
  emisorRegimenFiscal: string;
  emisorCodigoPostal: string;
  receptorRfc: string;
  receptorNombre: string;
  receptorCodigoPostal: string;
  receptorRegimenFiscal: string;
  usoCfdi: string;
  subtotal: ReturnType<typeof dec>;
  descuento: ReturnType<typeof dec>;
  total: ReturnType<typeof dec>;
  status: string;
  canceledAt: Date | null;
  canceledBy: string | null;
  cancellationReasonId: string | null;
  cancellationComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function facturaFixture(overrides: Partial<FacturaRow> = {}): FacturaRow {
  return {
    id: 'factura-1',
    folio: 'STORE001-F0001',
    storeId: 'store-1',
    saleId: 'sale-1',
    clienteId: 'cliente-1',
    userId: 'user-1',
    emisorRfc: 'SER010101AAA',
    emisorNombre: 'Abarrotes Servicaja',
    emisorRegimenFiscal: '601',
    emisorCodigoPostal: '81200',
    receptorRfc: 'XAXX010101000',
    receptorNombre: 'Público en General',
    receptorCodigoPostal: '81200',
    receptorRegimenFiscal: '601',
    usoCfdi: 'G01',
    subtotal: dec('100.00'),
    descuento: dec('0.00'),
    total: dec('116.00'),
    status: 'EMITIDA',
    canceledAt: null,
    canceledBy: null,
    cancellationReasonId: null,
    cancellationComment: null,
    createdAt: FECHA,
    updatedAt: FECHA,
    ...overrides,
  };
}

function ventaConItems() {
  return {
    ...saleFixture({
      id: 'sale-1',
      saleNumber: 'STORE001-0001',
      subtotal: dec('100.00'),
      discount: dec('5.00'),
      total: dec('95.00'),
    }),
    items: [
      {
        id: 'item-1',
        quantity: dec('2.000'),
        unitPrice: dec('15.00'),
        product: { name: 'Refresco 600ml' },
      },
      {
        id: 'item-2',
        quantity: dec('0.500'),
        unitPrice: dec('10.00'),
        product: { name: 'Jamon 100g' },
      },
    ],
  };
}

const storeFiscal = () =>
  storeFixture({
    id: 'store-1',
    code: 'STORE001',
    name: 'Abarrotes Servicaja',
    rfc: 'SER010101AAA',
    regimenFiscal: '601',
    codigoPostal: '81200',
  });

describe('buscarVentaPorNumero', () => {
  it('normaliza el número de venta y resume artículos e importes', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(ventaConItems());
    const factura = {
      id: 'factura-1',
      folio: 'STORE001-F0001',
      status: 'EMITIDA',
      createdAt: FECHA,
    };
    prismaMock.factura.findUnique.mockResolvedValue(factura);

    const resultado = await buscarVentaPorNumero('  store001-0001  ', 'store-1');

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith({
      where: { saleNumber: 'STORE001-0001', storeId: 'store-1' },
      include: { items: { include: { product: { select: { name: true } } } } },
    });
    expect(prismaMock.factura.findUnique).toHaveBeenCalledWith({
      where: { saleId: 'sale-1' },
      select: { id: true, folio: true, status: true, createdAt: true },
    });
    expect(resultado).toEqual({
      id: 'sale-1',
      saleNumber: 'STORE001-0001',
      fecha: FECHA,
      subtotal: 100,
      descuento: 5,
      total: 95,
      articulos: 2.5,
      estado: 'COMPLETED',
      factura,
      items: [
        { quantity: 2, unitPrice: 15, product: { name: 'Refresco 600ml' } },
        { quantity: 0.5, unitPrice: 10, product: { name: 'Jamon 100g' } },
      ],
    });
  });

  it('devuelve factura null cuando la venta aún no está facturada', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(ventaConItems());
    prismaMock.factura.findUnique.mockResolvedValue(null);

    const resultado = await buscarVentaPorNumero('STORE001-0001', 'store-1');

    expect(resultado.factura).toBeNull();
  });

  it('lanza VENTA_NOT_FOUND si no existe la venta en la tienda', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expectApiError(() => buscarVentaPorNumero('store001-9999', 'store-1'), {
      status: 404,
      code: 'VENTA_NOT_FOUND',
      message: /STORE001-9999/,
    });
    expect(prismaMock.factura.findUnique).not.toHaveBeenCalled();
  });
});

describe('emitirFactura', () => {
  const entrada = {
    storeId: 'store-1',
    userId: 'user-1',
    clienteId: 'cliente-1',
    usoCfdi: 'G03',
  };

  it('emite la factura dentro de la transacción y audita el folio generado', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(
      saleFixture({
        id: 'sale-1',
        saleNumber: 'STORE001-0001',
        status: 'COMPLETED',
        subtotal: dec('100.00'),
        discount: dec('0.00'),
        total: dec('116.00'),
      })
    );
    prismaMock.factura.findUnique.mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue(storeFiscal());
    prismaMock.cliente.findFirst.mockResolvedValue(clienteFixture({ id: 'cliente-1' }));
    prismaMock.store.update.mockResolvedValue(storeFixture({ facturaSequence: 7 }));
    const creada = facturaFixture({ id: 'factura-1', folio: 'STORE001-F0007', usoCfdi: 'G03' });
    prismaMock.factura.create.mockResolvedValue(creada);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await emitirFactura({ ...entrada, ventaId: 'sale-1' });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith({
      where: { id: 'sale-1', storeId: 'store-1', status: 'COMPLETED' },
    });
    expect(prismaMock.factura.findUnique).toHaveBeenCalledWith({
      where: { saleId: 'sale-1' },
    });
    // generarFolio incrementa la secuencia y formatea con 4 dígitos.
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { facturaSequence: { increment: 1 } },
    });
    expect(prismaMock.factura.create).toHaveBeenCalledWith({
      data: {
        folio: 'STORE001-F0007',
        storeId: 'store-1',
        saleId: 'sale-1',
        clienteId: 'cliente-1',
        userId: 'user-1',
        emisorRfc: 'SER010101AAA',
        emisorNombre: 'Abarrotes Servicaja',
        emisorRegimenFiscal: '601',
        emisorCodigoPostal: '81200',
        receptorRfc: 'XAXX010101000',
        receptorNombre: 'Público en General',
        receptorCodigoPostal: '81200',
        receptorRegimenFiscal: '601',
        usoCfdi: 'G03',
        subtotal: dec('100.00'),
        descuento: dec('0.00'),
        total: dec('116.00'),
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'CREATE',
        entity: 'FACTURA',
        entityId: 'factura-1',
        metadata: {
          folio: 'STORE001-F0007',
          venta: 'STORE001-0001',
          total: '116',
          receptorRfc: 'XAXX010101000',
          usoCfdi: 'G03',
        },
      },
    });
    expect(resultado).toEqual({
      id: 'factura-1',
      folio: 'STORE001-F0007',
      venta: 'STORE001-0001',
      total: 116,
      usoCfdi: 'G03',
      createdAt: FECHA,
    });
  });

  it('busca la venta por saleNumber normalizado cuando no llega ventaId', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(
      saleFixture({ id: 'sale-1', status: 'COMPLETED' })
    );
    prismaMock.factura.findUnique.mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue(storeFiscal());
    prismaMock.cliente.findFirst.mockResolvedValue(clienteFixture({ id: 'cliente-1' }));
    prismaMock.store.update.mockResolvedValue(storeFixture({ facturaSequence: 1 }));
    prismaMock.factura.create.mockResolvedValue(facturaFixture({ folio: 'STORE001-F0001' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await emitirFactura({ ...entrada, saleNumber: '  store001-0001 ' });

    expect(prismaMock.sale.findFirst).toHaveBeenCalledWith({
      where: { saleNumber: 'STORE001-0001', storeId: 'store-1', status: 'COMPLETED' },
    });
  });

  it('lanza VENTA_NOT_FOUND si la venta no existe o está cancelada', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(null);

    await expectApiError(() => emitirFactura({ ...entrada, ventaId: 'sale-x' }), {
      status: 404,
      code: 'VENTA_NOT_FOUND',
      message: 'Venta no encontrada o cancelada',
    });
    expect(prismaMock.factura.findUnique).not.toHaveBeenCalled();
  });

  it('lanza VENTA_YA_FACTURADA si la venta ya tiene factura emitida', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(saleFixture({ id: 'sale-1' }));
    prismaMock.factura.findUnique.mockResolvedValue(
      facturaFixture({ folio: 'STORE001-F0001', status: 'EMITIDA' })
    );

    await expectApiError(() => emitirFactura({ ...entrada, ventaId: 'sale-1' }), {
      status: 409,
      code: 'VENTA_YA_FACTURADA',
      message: /STORE001-0001.*STORE001-F0001/,
    });
    expect(prismaMock.factura.create).not.toHaveBeenCalled();
  });

  it('lanza VENTA_CON_FACTURA_CANCELADA si la factura previa fue cancelada', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(saleFixture({ id: 'sale-1' }));
    prismaMock.factura.findUnique.mockResolvedValue(
      facturaFixture({ folio: 'STORE001-F0002', status: 'CANCELADA' })
    );

    await expectApiError(() => emitirFactura({ ...entrada, ventaId: 'sale-1' }), {
      status: 400,
      code: 'VENTA_CON_FACTURA_CANCELADA',
      message: /STORE001-F0002/,
    });
  });

  it('lanza STORE_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(saleFixture({ id: 'sale-1' }));
    prismaMock.factura.findUnique.mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => emitirFactura({ ...entrada, ventaId: 'sale-1' }), {
      status: 404,
      code: 'STORE_NOT_FOUND',
    });
  });

  it('lanza DATOS_FISCALES_INCOMPLETOS cuando falta el RFC del emisor', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(saleFixture({ id: 'sale-1' }));
    prismaMock.factura.findUnique.mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue(
      storeFixture({ id: 'store-1', rfc: null, regimenFiscal: '601', codigoPostal: '81200' })
    );

    await expectApiError(() => emitirFactura({ ...entrada, ventaId: 'sale-1' }), {
      status: 400,
      code: 'DATOS_FISCALES_INCOMPLETOS',
      message: /Faltan: RFC$/,
    });
    expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
  });

  it('lista todos los datos fiscales faltantes en el mensaje', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(saleFixture({ id: 'sale-1' }));
    prismaMock.factura.findUnique.mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue(
      storeFixture({ id: 'store-1', rfc: null, regimenFiscal: null, codigoPostal: null })
    );

    await expectApiError(() => emitirFactura({ ...entrada, ventaId: 'sale-1' }), {
      status: 400,
      code: 'DATOS_FISCALES_INCOMPLETOS',
      message: /Faltan: RFC, Régimen fiscal, Código postal$/,
    });
  });

  it('lanza CLIENTE_NOT_FOUND si el cliente no pertenece a la tienda', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(saleFixture({ id: 'sale-1' }));
    prismaMock.factura.findUnique.mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue(storeFiscal());
    prismaMock.cliente.findFirst.mockResolvedValue(null);

    await expectApiError(() => emitirFactura({ ...entrada, ventaId: 'sale-1' }), {
      status: 404,
      code: 'CLIENTE_NOT_FOUND',
    });
    expect(prismaMock.cliente.findFirst).toHaveBeenCalledWith({
      where: { id: 'cliente-1', storeId: 'store-1' },
    });
  });

  it('lanza CLIENTE_INACTIVO si el cliente está desactivado', async () => {
    prismaMock.sale.findFirst.mockResolvedValue(saleFixture({ id: 'sale-1' }));
    prismaMock.factura.findUnique.mockResolvedValue(null);
    prismaMock.store.findUnique.mockResolvedValue(storeFiscal());
    prismaMock.cliente.findFirst.mockResolvedValue(
      clienteFixture({ id: 'cliente-1', isActive: false })
    );

    await expectApiError(() => emitirFactura({ ...entrada, ventaId: 'sale-1' }), {
      status: 400,
      code: 'CLIENTE_INACTIVO',
    });
    expect(prismaMock.store.update).not.toHaveBeenCalled();
  });
});

describe('listarFacturas', () => {
  it('sin filtros consulta todas las facturas de la tienda', async () => {
    prismaMock.factura.findMany.mockResolvedValue([]);

    await listarFacturas('store-1');

    expect(prismaMock.factura.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      include: {
        cliente: { select: { id: true, rfc: true, nombreRazonSocial: true } },
        sale: { select: { id: true, saleNumber: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('filtra por status', async () => {
    prismaMock.factura.findMany.mockResolvedValue([]);

    await listarFacturas('store-1', { status: 'CANCELADA' });

    const args = prismaMock.factura.findMany.mock.calls[0]?.[0];
    expect(args.where).toEqual({ storeId: 'store-1', status: 'CANCELADA' });
  });

  it('filtra por fecha inicial en día de México', async () => {
    prismaMock.factura.findMany.mockResolvedValue([]);

    await listarFacturas('store-1', { status: 'EMITIDA', startDate: '2026-01-01' });

    const args = prismaMock.factura.findMany.mock.calls[0]?.[0];
    expect(args.where).toEqual({
      storeId: 'store-1',
      status: 'EMITIDA',
      createdAt: { gte: mexicoStartOfDay('2026-01-01') },
    });
  });

  it('filtra por fecha final en día de México', async () => {
    prismaMock.factura.findMany.mockResolvedValue([]);

    await listarFacturas('store-1', { endDate: '2026-01-31' });

    const args = prismaMock.factura.findMany.mock.calls[0]?.[0];
    expect(args.where).toEqual({
      storeId: 'store-1',
      createdAt: { lte: mexicoEndOfDay('2026-01-31') },
    });
  });

  it('combina fecha inicial y final en un rango', async () => {
    prismaMock.factura.findMany.mockResolvedValue([]);

    await listarFacturas('store-1', { startDate: '2026-01-01', endDate: '2026-01-31' });

    const args = prismaMock.factura.findMany.mock.calls[0]?.[0];
    expect(args.where).toEqual({
      storeId: 'store-1',
      createdAt: {
        gte: mexicoStartOfDay('2026-01-01'),
        lte: mexicoEndOfDay('2026-01-31'),
      },
    });
  });
});

describe('obtenerFactura', () => {
  it('lanza FACTURA_NOT_FOUND si no existe en la tienda', async () => {
    prismaMock.factura.findFirst.mockResolvedValue(null);

    await expectApiError(() => obtenerFactura('factura-x', 'store-1'), {
      status: 404,
      code: 'FACTURA_NOT_FOUND',
    });
    expect(prismaMock.factura.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'factura-x', storeId: 'store-1' } })
    );
  });

  it('convierte importes y cantidades de Decimal a número', async () => {
    prismaMock.factura.findFirst.mockResolvedValue({
      ...facturaFixture(),
      cliente: clienteFixture({ id: 'cliente-1' }),
      sale: {
        id: 'sale-1',
        saleNumber: 'STORE001-0001',
        createdAt: FECHA,
        items: [
          { quantity: dec('2.000'), unitPrice: dec('15.00'), product: { name: 'Refresco' } },
          { quantity: dec('1.250'), unitPrice: dec('30.50'), product: { name: 'Jamon' } },
        ],
      },
      user: { id: 'user-1', name: 'Vendedor' },
    });

    const resultado = await obtenerFactura('factura-1', 'store-1');

    expect(resultado.subtotal).toBe(100);
    expect(resultado.descuento).toBe(0);
    expect(resultado.total).toBe(116);
    expect(resultado.sale.items).toEqual([
      { quantity: 2, unitPrice: 15, product: { name: 'Refresco' } },
      { quantity: 1.25, unitPrice: 30.5, product: { name: 'Jamon' } },
    ]);
    expect(resultado.sale.saleNumber).toBe('STORE001-0001');
    expect(resultado.cliente).toEqual(clienteFixture({ id: 'cliente-1' }));
  });
});

describe('cancelarFactura', () => {
  it('lanza FACTURA_NOT_FOUND si no existe o ya está cancelada', async () => {
    prismaMock.factura.findFirst.mockResolvedValue(null);

    await expectApiError(() => cancelarFactura('factura-x', 'store-1', 'user-1'), {
      status: 404,
      code: 'FACTURA_NOT_FOUND',
      message: 'Factura no encontrada o ya cancelada',
    });
    expect(prismaMock.factura.findFirst).toHaveBeenCalledWith({
      where: { id: 'factura-x', storeId: 'store-1', status: 'EMITIDA' },
    });
    expect(prismaMock.factura.update).not.toHaveBeenCalled();
  });

  it('cancela sin motivo ni comentario y audita el folio', async () => {
    const factura = facturaFixture();
    prismaMock.factura.findFirst.mockResolvedValue(factura);
    const cancelada = facturaFixture({ status: 'CANCELADA', canceledAt: FECHA, canceledBy: 'user-1' });
    prismaMock.factura.update.mockResolvedValue(cancelada);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await cancelarFactura('factura-1', 'store-1', 'user-1');

    expect(resultado).toEqual(cancelada);
    expect(prismaMock.factura.update).toHaveBeenCalledWith({
      where: { id: 'factura-1' },
      data: {
        status: 'CANCELADA',
        canceledAt: expect.any(Date),
        canceledBy: 'user-1',
      },
    });
    expect(prismaMock.cancellation.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'CANCEL_FACTURA',
        entity: 'FACTURA',
        entityId: 'factura-1',
        metadata: { folio: 'STORE001-F0001' },
      },
    });
  });

  it('registra la cancelación con motivo y comentario', async () => {
    prismaMock.factura.findFirst.mockResolvedValue(facturaFixture());
    prismaMock.factura.update.mockResolvedValue(facturaFixture({ status: 'CANCELADA' }));
    prismaMock.cancellation.create.mockResolvedValue({ id: 'cancelacion-1' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await cancelarFactura('factura-1', 'store-1', 'user-1', 'motivo-1', 'Error de captura');

    expect(prismaMock.factura.update).toHaveBeenCalledWith({
      where: { id: 'factura-1' },
      data: expect.objectContaining({
        cancellationReasonId: 'motivo-1',
        cancellationComment: 'Error de captura',
      }),
    });
    expect(prismaMock.cancellation.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        entityType: 'FACTURA',
        entityId: 'factura-1',
        entityNumber: 'STORE001-F0001',
        total: dec('116.00'),
        type: 'FULL',
        cancellationReasonId: 'motivo-1',
        comment: 'Error de captura',
      },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: {
          folio: 'STORE001-F0001',
          cancellationReasonId: 'motivo-1',
          comment: 'Error de captura',
        },
      }),
    });
  });

  it('guarda comentario null y lo omite del AuditLog', async () => {
    prismaMock.factura.findFirst.mockResolvedValue(facturaFixture());
    prismaMock.factura.update.mockResolvedValue(facturaFixture({ status: 'CANCELADA' }));
    prismaMock.cancellation.create.mockResolvedValue({ id: 'cancelacion-2' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-3' });

    await cancelarFactura('factura-1', 'store-1', 'user-1', 'motivo-1', null);

    expect(prismaMock.factura.update).toHaveBeenCalledWith({
      where: { id: 'factura-1' },
      data: expect.objectContaining({ cancellationComment: null }),
    });
    expect(prismaMock.cancellation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ comment: null }),
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: { folio: 'STORE001-F0001', cancellationReasonId: 'motivo-1' },
      }),
    });
  });
});
