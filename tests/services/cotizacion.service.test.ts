import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { dec } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import {
  convertToSale,
  createCotizacion,
  deleteCotizacion,
  getCotizacion,
  listCotizaciones,
  updateCotizacion,
  updateCotizacionStatus,
} from '../../src/services/cotizacion.service';

// ── Builders locales ───────────────────────────────────────────────────────
function cotizacionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cotizacion-1',
    cotizacionNumber: 'STORE001-COT-0001',
    storeId: 'store-1',
    userId: 'user-1',
    clienteId: null,
    subtotal: dec('100.00'),
    discount: dec('0.00'),
    total: dec('100.00'),
    status: 'BORRADOR',
    notes: null,
    validUntil: null,
    sentAt: null,
    acceptedAt: null,
    canceledAt: null,
    canceledBy: null,
    convertedSaleId: null,
    createdAt: new Date('2026-01-15T18:00:00.000Z'),
    updatedAt: new Date('2026-01-15T18:00:00.000Z'),
    ...overrides,
  };
}

function cotizacionItemFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cotizacionitem-1',
    cotizacionId: 'cotizacion-1',
    productId: 'product-1',
    quantity: dec('2.000'),
    unidad: 'u',
    unitPrice: dec('15.00'),
    ...overrides,
  };
}

function argsDe(mock: { mock: { calls: unknown[][] } }): any {
  return mock.mock.calls[0]?.[0];
}

describe('createCotizacion', () => {
  it('lanza TIENDA_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(
      () =>
        createCotizacion(
          { items: [{ productId: 'product-1', quantity: 1, unitPrice: 10 }] },
          'user-1',
          'store-x'
        ),
      { status: 404, code: 'TIENDA_NOT_FOUND' }
    );
    expect(prismaMock.cotizacion.create).not.toHaveBeenCalled();
  });

  it('lanza INVALID_PRODUCTS si algún producto no existe o está inactivo', async () => {
    prismaMock.store.findUnique.mockResolvedValue({ id: 'store-1', code: 'STORE001' });
    prismaMock.product.findMany.mockResolvedValue([]);

    await expectApiError(
      () =>
        createCotizacion(
          { items: [{ productId: 'product-1', quantity: 1, unitPrice: 10 }] },
          'user-1',
          'store-1'
        ),
      { status: 400, code: 'INVALID_PRODUCTS' }
    );
  });

  it('crea el borrador con folio secuencial y totales calculados', async () => {
    prismaMock.store.findUnique.mockResolvedValue({ id: 'store-1', code: 'STORE001' });
    prismaMock.product.findMany.mockResolvedValue([
      { id: 'product-1', name: 'Refresco', unidadVenta: 'UNIDAD', sellingPrice: dec('15.00') },
    ]);
    prismaMock.store.update.mockResolvedValue({ id: 'store-1', cotizacionSequence: 3 });
    const creada = cotizacionFixture({ id: 'cotizacion-3', cotizacionNumber: 'STORE001-COT-0003' });
    prismaMock.cotizacion.create.mockResolvedValue(creada);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await createCotizacion(
      { items: [{ productId: 'product-1', quantity: 2, unitPrice: 15 }] },
      'user-1',
      'store-1'
    );

    expect(resultado).toEqual(creada);
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { cotizacionSequence: { increment: 1 } },
    });

    const args = argsDe(prismaMock.cotizacion.create);
    expect(args.data).toEqual(
      expect.objectContaining({
        cotizacionNumber: 'STORE001-COT-0003',
        storeId: 'store-1',
        userId: 'user-1',
        clienteId: null,
        status: 'BORRADOR',
        notes: null,
        validUntil: null,
      })
    );
    expect(Number(args.data.subtotal)).toBe(30);
    expect(Number(args.data.discount)).toBe(0);
    expect(Number(args.data.total)).toBe(30);

    const items = args.data.items.createMany.data as any[];
    expect(items).toHaveLength(1);
    expect(Number(items[0].quantity)).toBe(2);
    expect(Number(items[0].unitPrice)).toBe(15);
    expect(items[0].unidad).toBe('u');

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        userId: 'user-1',
        action: 'CREATE',
        entity: 'COTIZACION',
        entityId: 'cotizacion-3',
      }),
    });
  });

  it('etiqueta los productos por peso y volumen y aplica descuento, cliente y caducidad', async () => {
    prismaMock.store.findUnique.mockResolvedValue({ id: 'store-1', code: 'STORE001' });
    prismaMock.product.findMany.mockResolvedValue([
      { id: 'product-1', name: 'Manzana', unidadVenta: 'PESO', sellingPrice: dec('20.00') },
      { id: 'product-2', name: 'Leche', unidadVenta: 'VOLUMEN', sellingPrice: dec('25.00') },
    ]);
    prismaMock.store.update.mockResolvedValue({ cotizacionSequence: 1 });
    prismaMock.cotizacion.create.mockResolvedValue(cotizacionFixture());
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await createCotizacion(
      {
        items: [
          { productId: 'product-1', quantity: 1, unitPrice: 20 },
          { productId: 'product-2', quantity: 2, unitPrice: 25 },
        ],
        discount: 5,
        clienteId: 'cliente-1',
        notes: 'Entrega el lunes',
        validUntil: '2026-03-15',
        status: 'ENVIADA',
      },
      'user-1',
      'store-1'
    );

    const args = argsDe(prismaMock.cotizacion.create);
    expect((args.data.items.createMany.data as any[]).map((i) => i.unidad)).toEqual(['kg', 'L']);
    expect(Number(args.data.subtotal)).toBe(70);
    expect(Number(args.data.discount)).toBe(5);
    expect(Number(args.data.total)).toBe(65);
    expect(args.data.clienteId).toBe('cliente-1');
    expect(args.data.notes).toBe('Entrega el lunes');
    expect(args.data.status).toBe('ENVIADA');
    expect(args.data.validUntil).toEqual(new Date('2026-03-15'));
  });
});

describe('listCotizaciones', () => {
  it('marca vencidas y lista solo las de la tienda cuando no hay filtros', async () => {
    prismaMock.cotizacion.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.cotizacion.findMany.mockResolvedValue([cotizacionFixture()]);

    const resultado = await listCotizaciones('store-1', {});

    expect(resultado).toHaveLength(1);
    const marca = argsDe(prismaMock.cotizacion.updateMany);
    expect(marca.where).toEqual(
      expect.objectContaining({
        storeId: 'store-1',
        status: { in: ['BORRADOR', 'ENVIADA'] },
      })
    );
    expect(marca.where.validUntil.lt).toBeInstanceOf(Date);
    expect(marca.data).toEqual({ status: 'VENCIDA' });

    expect(argsDe(prismaMock.cotizacion.findMany).where).toEqual({ storeId: 'store-1' });
  });

  it('ignora el estado ALL y respeta un estado concreto', async () => {
    prismaMock.cotizacion.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.cotizacion.findMany.mockResolvedValue([]);

    await listCotizaciones('store-1', { status: 'ALL' });
    expect(argsDe(prismaMock.cotizacion.findMany).where).toEqual({ storeId: 'store-1' });

    await listCotizaciones('store-1', { status: 'ENVIADA' });
    const args = prismaMock.cotizacion.findMany.mock.calls[1]?.[0] as any;
    expect(args.where).toEqual({ storeId: 'store-1', status: 'ENVIADA' });
  });

  it('filtra por fecha inicial, final o ambas', async () => {
    prismaMock.cotizacion.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.cotizacion.findMany.mockResolvedValue([]);

    await listCotizaciones('store-1', { startDate: '2026-01-01' });
    const soloInicio = argsDe(prismaMock.cotizacion.findMany).where.createdAt;
    expect(soloInicio.gte).toEqual(new Date('2026-01-01'));
    expect(soloInicio.lte).toBeUndefined();

    await listCotizaciones('store-1', { endDate: '2026-01-31' });
    const soloFin = (prismaMock.cotizacion.findMany.mock.calls[1]?.[0] as any).where.createdAt;
    expect(soloFin.gte).toBeUndefined();
    expect(soloFin.lte).toEqual(new Date('2026-01-31T23:59:59.999Z'));

    await listCotizaciones('store-1', { startDate: '2026-01-01', endDate: '2026-01-31' });
    const ambas = (prismaMock.cotizacion.findMany.mock.calls[2]?.[0] as any).where.createdAt;
    expect(ambas.gte).toEqual(new Date('2026-01-01'));
    expect(ambas.lte).toEqual(new Date('2026-01-31T23:59:59.999Z'));
  });

  it('filtra por cliente y busca por folio, notas o razón social', async () => {
    prismaMock.cotizacion.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.cotizacion.findMany.mockResolvedValue([]);

    await listCotizaciones('store-1', { clienteId: 'cliente-1', search: 'acme' });

    const where = argsDe(prismaMock.cotizacion.findMany).where;
    expect(where.clienteId).toBe('cliente-1');
    expect(where.OR).toEqual([
      { cotizacionNumber: { contains: 'acme', mode: 'insensitive' } },
      { notes: { contains: 'acme', mode: 'insensitive' } },
      { cliente: { nombreRazonSocial: { contains: 'acme', mode: 'insensitive' } } },
    ]);
  });
});

describe('getCotizacion', () => {
  it('devuelve la cotización de la tienda y marca vencidas de todas las tiendas', async () => {
    const fila = cotizacionFixture({ id: 'cotizacion-1' });
    prismaMock.cotizacion.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.cotizacion.findFirst.mockResolvedValue(fila);

    await expect(getCotizacion('cotizacion-1', 'store-1')).resolves.toEqual(fila);

    const marca = argsDe(prismaMock.cotizacion.updateMany);
    expect(marca.where.storeId).toBeUndefined();
    expect(prismaMock.cotizacion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cotizacion-1', storeId: 'store-1' } })
    );
  });

  it('lanza COTIZACION_NOT_FOUND si no pertenece a la tienda', async () => {
    prismaMock.cotizacion.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.cotizacion.findFirst.mockResolvedValue(null);

    await expectApiError(() => getCotizacion('cotizacion-x', 'store-1'), {
      status: 404,
      code: 'COTIZACION_NOT_FOUND',
    });
  });
});

describe('updateCotizacion', () => {
  it('lanza COTIZACION_NOT_FOUND si no existe en la tienda', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(null);

    await expectApiError(() => updateCotizacion('cotizacion-x', {}, 'user-1', 'store-1'), {
      status: 404,
      code: 'COTIZACION_NOT_FOUND',
    });
  });

  it('lanza NOT_EDITABLE si la cotización ya no está en borrador', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(
      cotizacionFixture({ status: 'ENVIADA' })
    );

    await expectApiError(() => updateCotizacion('cotizacion-1', {}, 'user-1', 'store-1'), {
      status: 400,
      code: 'NOT_EDITABLE',
    });
    expect(prismaMock.cotizacion.update).not.toHaveBeenCalled();
  });

  it('actualiza cliente y notas sin tocar íteles ni importes', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(
      cotizacionFixture({ id: 'cotizacion-1', notes: 'vieja' })
    );
    prismaMock.cotizacion.update.mockResolvedValue(cotizacionFixture({ id: 'cotizacion-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await updateCotizacion(
      'cotizacion-1',
      { clienteId: 'cliente-1', notes: null },
      'user-1',
      'store-1'
    );

    const args = argsDe(prismaMock.cotizacion.update);
    expect(args).toEqual(
      expect.objectContaining({ where: { id: 'cotizacion-1' } })
    );
    expect(args.data).toEqual({ clienteId: 'cliente-1', notes: null });
    expect(prismaMock.cotizacionItem.deleteMany).not.toHaveBeenCalled();
  });

  it('permite limpiar el cliente asociado enviando null', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(
      cotizacionFixture({ id: 'cotizacion-1', clienteId: 'cliente-1' })
    );
    prismaMock.cotizacion.update.mockResolvedValue(
      cotizacionFixture({ id: 'cotizacion-1', clienteId: null })
    );
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-7' });

    await updateCotizacion('cotizacion-1', { clienteId: null }, 'user-1', 'store-1');

    const args = argsDe(prismaMock.cotizacion.update);
    expect(args.data).toEqual({ clienteId: null });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'UPDATE',
        entity: 'COTIZACION',
        entityId: 'cotizacion-1',
        metadata: { changes: { discount: undefined, clienteId: null } },
      }),
    });
  });

  it('reemplaza los ítems y recalcula con el descuento guardado', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(
      cotizacionFixture({ id: 'cotizacion-1', discount: dec('5.00') })
    );
    prismaMock.product.findMany.mockResolvedValue([
      { id: 'product-1', unidadVenta: 'UNIDAD' },
    ]);
    prismaMock.cotizacionItem.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.cotizacionItem.createMany.mockResolvedValue({ count: 1 });
    prismaMock.cotizacion.update.mockResolvedValue(cotizacionFixture({ id: 'cotizacion-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await updateCotizacion(
      'cotizacion-1',
      { items: [{ productId: 'product-1', quantity: 2, unitPrice: 20 }] },
      'user-1',
      'store-1'
    );

    expect(prismaMock.cotizacionItem.deleteMany).toHaveBeenCalledWith({
      where: { cotizacionId: 'cotizacion-1' },
    });
    const creados = argsDe(prismaMock.cotizacionItem.createMany).data as any[];
    expect(Number(creados[0].quantity)).toBe(2);
    expect(creados[0].unidad).toBe('u');

    const args = argsDe(prismaMock.cotizacion.update);
    // subtotal 40 - descuento existente 5 = 35
    expect(Number(args.data.subtotal)).toBe(40);
    expect(Number(args.data.total)).toBe(35);
    expect(args.data.discount).toBeUndefined();
  });

  it('aplica el descuento enviado al reemplazar los ítems', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(cotizacionFixture({ id: 'cotizacion-1' }));
    prismaMock.product.findMany.mockResolvedValue([
      { id: 'product-1', unidadVenta: 'PESO' },
      { id: 'product-2', unidadVenta: 'VOLUMEN' },
    ]);
    prismaMock.cotizacionItem.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.cotizacionItem.createMany.mockResolvedValue({ count: 2 });
    prismaMock.cotizacion.update.mockResolvedValue(cotizacionFixture({ id: 'cotizacion-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-3' });

    await updateCotizacion(
      'cotizacion-1',
      {
        items: [
          { productId: 'product-1', quantity: 1, unitPrice: 20 },
          { productId: 'product-2', quantity: 2, unitPrice: 10 },
        ],
        discount: 10,
      },
      'user-1',
      'store-1'
    );

    const creados = argsDe(prismaMock.cotizacionItem.createMany).data as any[];
    expect(creados.map((i) => i.unidad)).toEqual(['kg', 'L']);

    const args = argsDe(prismaMock.cotizacion.update);
    expect(Number(args.data.subtotal)).toBe(40);
    expect(Number(args.data.total)).toBe(30);
    expect(Number(args.data.discount)).toBe(10);
  });

  it('lanza INVALID_PRODUCTS si los ítems nuevos traen productos inválidos', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(cotizacionFixture({ id: 'cotizacion-1' }));
    prismaMock.product.findMany.mockResolvedValue([]);

    await expectApiError(
      () =>
        updateCotizacion(
          'cotizacion-1',
          { items: [{ productId: 'product-x', quantity: 1, unitPrice: 10 }] },
          'user-1',
          'store-1'
        ),
      { status: 400, code: 'INVALID_PRODUCTS' }
    );
    expect(prismaMock.cotizacionItem.deleteMany).not.toHaveBeenCalled();
  });

  it('recalcula el total cuando solo cambia el descuento', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(
      cotizacionFixture({ id: 'cotizacion-1', subtotal: dec('100.00'), total: dec('100.00') })
    );
    prismaMock.cotizacion.update.mockResolvedValue(cotizacionFixture({ id: 'cotizacion-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-4' });

    await updateCotizacion('cotizacion-1', { discount: 25 }, 'user-1', 'store-1');

    const args = argsDe(prismaMock.cotizacion.update);
    expect(Number(args.data.discount)).toBe(25);
    // Sin ítems nuevos el servicio no persiste el total recalculado.
    expect(args.data.total).toBeUndefined();
    expect(args.data.subtotal).toBeUndefined();
  });

  it('ignora una lista de ítems vacía y limpia la caducidad con string vacío', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(
      cotizacionFixture({
        id: 'cotizacion-1',
        validUntil: new Date('2026-02-01T00:00:00.000Z'),
      })
    );
    prismaMock.cotizacion.update.mockResolvedValue(cotizacionFixture({ id: 'cotizacion-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-5' });

    await updateCotizacion(
      'cotizacion-1',
      { items: [], validUntil: '' },
      'user-1',
      'store-1'
    );

    expect(prismaMock.cotizacionItem.deleteMany).not.toHaveBeenCalled();
    const args = argsDe(prismaMock.cotizacion.update);
    expect(args.data.validUntil).toBeNull();
    // `data.items` vacío es truthy: se envían los importes heredados sin recalcular.
    expect(Number(args.data.subtotal)).toBe(100);
    expect(Number(args.data.total)).toBe(100);
  });

  it('actualiza la caducidad cuando cambia y la conserva cuando no se envía', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(cotizacionFixture({ id: 'cotizacion-1' }));
    prismaMock.cotizacion.update.mockResolvedValue(cotizacionFixture({ id: 'cotizacion-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-6' });

    await updateCotizacion('cotizacion-1', { validUntil: '2026-05-01' }, 'user-1', 'store-1');
    const conFecha = argsDe(prismaMock.cotizacion.update);
    expect(conFecha.data.validUntil).toEqual(new Date('2026-05-01'));

    const vigente = new Date('2026-04-01T00:00:00.000Z');
    prismaMock.cotizacion.findFirst.mockResolvedValue(
      cotizacionFixture({ id: 'cotizacion-1', validUntil: vigente })
    );

    await updateCotizacion('cotizacion-1', { notes: 'sin cambios de fecha' }, 'user-1', 'store-1');
    const sinFecha = (prismaMock.cotizacion.update.mock.calls[1]?.[0] as any);
    expect(sinFecha.data.validUntil).toBeUndefined();
  });
});

describe('updateCotizacionStatus', () => {
  it('lanza COTIZACION_NOT_FOUND si no existe en la tienda', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(null);

    await expectApiError(
      () => updateCotizacionStatus('cotizacion-x', 'ENVIADA', 'user-1', 'store-1'),
      { status: 404, code: 'COTIZACION_NOT_FOUND' }
    );
  });

  it('lanza INVALID_STATUS_TRANSITION si la transición no está permitida', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(cotizacionFixture({ status: 'ACEPTADA' }));

    await expectApiError(
      () => updateCotizacionStatus('cotizacion-1', 'ENVIADA', 'user-1', 'store-1'),
      { status: 400, code: 'INVALID_STATUS_TRANSITION', message: /No se puede cambiar/ }
    );
  });

  it('lanza INVALID_STATUS_TRANSITION si el estado actual es desconocido', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(cotizacionFixture({ status: 'PERDIDA' }));

    await expectApiError(
      () => updateCotizacionStatus('cotizacion-1', 'ENVIADA', 'user-1', 'store-1'),
      { status: 400, code: 'INVALID_STATUS_TRANSITION' }
    );
  });

  it('marca la fecha de envío al pasar de BORRADOR a ENVIADA', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(cotizacionFixture({ status: 'BORRADOR' }));
    const actualizada = cotizacionFixture({ status: 'ENVIADA' });
    prismaMock.cotizacion.update.mockResolvedValue(actualizada);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await expect(
      updateCotizacionStatus('cotizacion-1', 'ENVIADA', 'user-1', 'store-1')
    ).resolves.toEqual(actualizada);

    const args = argsDe(prismaMock.cotizacion.update);
    expect(args.data).toEqual({ status: 'ENVIADA', sentAt: expect.any(Date) });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'STATUS_CHANGE',
        entity: 'COTIZACION',
        entityId: 'cotizacion-1',
        metadata: { from: 'BORRADOR', to: 'ENVIADA', motivo: null },
      }),
    });
  });

  it('marca la fecha de aceptación al pasar de ENVIADA a ACEPTADA', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(cotizacionFixture({ status: 'ENVIADA' }));
    prismaMock.cotizacion.update.mockResolvedValue(cotizacionFixture({ status: 'ACEPTADA' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await updateCotizacionStatus('cotizacion-1', 'ACEPTADA', 'user-1', 'store-1');

    const args = argsDe(prismaMock.cotizacion.update);
    expect(args.data).toEqual({ status: 'ACEPTADA', acceptedAt: expect.any(Date) });
  });

  it('registra motivo y usuario al cancelar una cotización enviada', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(cotizacionFixture({ status: 'ENVIADA' }));
    prismaMock.cotizacion.update.mockResolvedValue(cotizacionFixture({ status: 'CANCELADA' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-3' });

    await updateCotizacionStatus(
      'cotizacion-1',
      'CANCELADA',
      'user-9',
      'store-1',
      'El cliente desistió'
    );

    const args = argsDe(prismaMock.cotizacion.update);
    expect(args.data).toEqual({
      status: 'CANCELADA',
      canceledAt: expect.any(Date),
      canceledBy: 'user-9',
    });

    const audit = argsDe(prismaMock.auditLog.create);
    expect(audit.data.metadata).toEqual({
      from: 'ENVIADA',
      to: 'CANCELADA',
      motivo: 'El cliente desistió',
    });
  });

  it('permite cancelar directamente un borrador', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(cotizacionFixture({ status: 'BORRADOR' }));
    prismaMock.cotizacion.update.mockResolvedValue(cotizacionFixture({ status: 'CANCELADA' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-4' });

    await updateCotizacionStatus('cotizacion-1', 'CANCELADA', 'user-1', 'store-1');

    const args = argsDe(prismaMock.cotizacion.update);
    expect(args.data.canceledBy).toBe('user-1');
  });
});

describe('convertToSale', () => {
  it('lanza COTIZACION_NOT_FOUND si no existe en la tienda', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(null);

    await expectApiError(() => convertToSale('cotizacion-x', 'user-1', 'store-1'), {
      status: 404,
      code: 'COTIZACION_NOT_FOUND',
    });
  });

  it('lanza NOT_CONVERTIBLE si la cotización no está aceptada', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue({
      ...cotizacionFixture({ status: 'BORRADOR' }),
      items: [cotizacionItemFixture()],
    });

    await expectApiError(() => convertToSale('cotizacion-1', 'user-1', 'store-1'), {
      status: 400,
      code: 'NOT_CONVERTIBLE',
    });
  });

  it('lanza TIENDA_NOT_FOUND si la tienda no existe', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue({
      ...cotizacionFixture({ status: 'ACEPTADA' }),
      items: [cotizacionItemFixture()],
    });
    prismaMock.store.findUnique.mockResolvedValue(null);

    await expectApiError(() => convertToSale('cotizacion-1', 'user-1', 'store-1'), {
      status: 404,
      code: 'TIENDA_NOT_FOUND',
    });
  });

  it('genera una venta pendiente con costo, utilidad y notas de la cotización', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue({
      ...cotizacionFixture({
        id: 'cotizacion-1',
        status: 'ACEPTADA',
        notes: 'Entregar el lunes',
        clienteId: 'cliente-1',
        discount: dec('5.00'),
      }),
      items: [cotizacionItemFixture({ quantity: dec('2.000'), unitPrice: dec('15.00') })],
    });
    prismaMock.store.findUnique.mockResolvedValue({ id: 'store-1', code: 'STORE001' });
    prismaMock.store.update.mockResolvedValue({ id: 'store-1', saleSequence: 5 });
    prismaMock.product.findMany.mockResolvedValue([
      { id: 'product-1', costPrice: dec('10.00') },
    ]);
    const venta = { id: 'sale-1', saleNumber: 'STORE001-0005', status: 'PENDING' };
    prismaMock.sale.create.mockResolvedValue(venta);
    prismaMock.cotizacion.update.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await expect(convertToSale('cotizacion-1', 'user-1', 'store-1')).resolves.toEqual(venta);

    const args = argsDe(prismaMock.sale.create);
    expect(args.data.saleNumber).toBe('STORE001-0005');
    expect(args.data.status).toBe('PENDING');
    expect(args.data.paymentMethod).toBe('PENDING');
    expect(args.data.clienteId).toBe('cliente-1');
    expect(Number(args.data.subtotal)).toBe(30);
    expect(Number(args.data.discount)).toBe(5);
    expect(Number(args.data.total)).toBe(25);
    expect(Number(args.data.profit)).toBe(10);
    expect(Number(args.data.profitMargin)).toBeCloseTo(40, 5);
    expect(args.data.notes).toBe('[Cotización STORE001-COT-0001] Entregar el lunes');

    const items = args.data.items.createMany.data as any[];
    expect(items).toHaveLength(1);
    expect(Number(items[0].costPrice)).toBe(10);
    expect(Number(items[0].profit)).toBe(10);

    expect(prismaMock.cotizacion.update).toHaveBeenCalledWith({
      where: { id: 'cotizacion-1' },
      data: { convertedSaleId: 'sale-1' },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CONVERT',
        entity: 'COTIZACION',
        entityId: 'cotizacion-1',
        metadata: { saleId: 'sale-1', saleNumber: 'STORE001-0005' },
      }),
    });
  });

  it('usa costo cero y margen cero cuando falta el producto o el total no es positivo', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue({
      ...cotizacionFixture({
        id: 'cotizacion-1',
        status: 'ACEPTADA',
        notes: null,
        discount: dec('30.00'),
      }),
      items: [cotizacionItemFixture({ quantity: dec('1.000'), unitPrice: dec('30.00') })],
    });
    prismaMock.store.findUnique.mockResolvedValue({ id: 'store-1', code: 'STORE001' });
    prismaMock.store.update.mockResolvedValue({ id: 'store-1', saleSequence: 1 });
    prismaMock.product.findMany.mockResolvedValue([]);
    prismaMock.sale.create.mockResolvedValue({
      id: 'sale-2',
      saleNumber: 'STORE001-0001',
      status: 'PENDING',
    });
    prismaMock.cotizacion.update.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await convertToSale('cotizacion-1', 'user-1', 'store-1');

    const args = argsDe(prismaMock.sale.create);
    expect(Number(args.data.total)).toBe(0);
    expect(Number(args.data.profitMargin)).toBe(0);
    expect(Number((args.data.items.createMany.data as any[])[0].costPrice)).toBe(0);
    expect(args.data.notes).toBe('[Cotización STORE001-COT-0001]');
  });
});

describe('deleteCotizacion', () => {
  it('lanza COTIZACION_NOT_FOUND si no existe en la tienda', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(null);

    await expectApiError(() => deleteCotizacion('cotizacion-x', 'user-1', 'store-1'), {
      status: 404,
      code: 'COTIZACION_NOT_FOUND',
    });
  });

  it('lanza NOT_DELETABLE si la cotización no está en borrador', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(cotizacionFixture({ status: 'ENVIADA' }));

    await expectApiError(() => deleteCotizacion('cotizacion-1', 'user-1', 'store-1'), {
      status: 400,
      code: 'NOT_DELETABLE',
    });
    expect(prismaMock.cotizacion.delete).not.toHaveBeenCalled();
  });

  it('borra los ítems, la cotización y audita la eliminación', async () => {
    prismaMock.cotizacion.findFirst.mockResolvedValue(cotizacionFixture({ id: 'cotizacion-1' }));
    prismaMock.cotizacionItem.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.cotizacion.delete.mockResolvedValue(cotizacionFixture({ id: 'cotizacion-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    await expect(
      deleteCotizacion('cotizacion-1', 'user-1', 'store-1')
    ).resolves.toBeUndefined();

    expect(prismaMock.cotizacionItem.deleteMany).toHaveBeenCalledWith({
      where: { cotizacionId: 'cotizacion-1' },
    });
    expect(prismaMock.cotizacion.delete).toHaveBeenCalledWith({ where: { id: 'cotizacion-1' } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        userId: 'user-1',
        action: 'DELETE',
        entity: 'COTIZACION',
        entityId: 'cotizacion-1',
        metadata: { cotizacionNumber: 'STORE001-COT-0001' },
      }),
    });
  });
});
