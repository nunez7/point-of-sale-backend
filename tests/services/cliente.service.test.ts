import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { clienteFixture } from '../helpers/fixtures';
import { expectApiError } from '../helpers/expectApiError';
import {
  actualizarCliente,
  crearCliente,
  eliminarCliente,
  listarClientes,
  obtenerCliente,
} from '../../src/services/cliente.service';

const entrada = {
  rfc: 'xaxx010101000',
  nombreRazonSocial: 'Público en General',
  codigoPostal: '81200',
  regimenFiscal: '601',
};

describe('listarClientes', () => {
  it('por defecto solo trae activos y ordena por razón social', async () => {
    prismaMock.cliente.findMany.mockResolvedValue([]);

    await listarClientes('store-1');

    expect(prismaMock.cliente.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', isActive: true },
      orderBy: { nombreRazonSocial: 'asc' },
      take: 100,
    });
  });

  it('includeInactive no filtra por isActive', async () => {
    prismaMock.cliente.findMany.mockResolvedValue([]);

    await listarClientes('store-1', undefined, true);

    expect(prismaMock.cliente.findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      orderBy: { nombreRazonSocial: 'asc' },
      take: 100,
    });
  });

  it('busca por RFC o razón social con el término recortado', async () => {
    prismaMock.cliente.findMany.mockResolvedValue([]);

    await listarClientes('store-1', '  acme  ');

    const args = prismaMock.cliente.findMany.mock.calls[0]?.[0];
    expect(args.where.OR).toEqual([
      { rfc: { contains: 'acme', mode: 'insensitive' } },
      { nombreRazonSocial: { contains: 'acme', mode: 'insensitive' } },
    ]);
  });

  it('ignora un término de búsqueda vacío', async () => {
    prismaMock.cliente.findMany.mockResolvedValue([]);

    await listarClientes('store-1', '   ');

    const args = prismaMock.cliente.findMany.mock.calls[0]?.[0];
    expect(args.where.OR).toBeUndefined();
  });
});

describe('obtenerCliente', () => {
  it('devuelve el cliente de la tienda', async () => {
    const fila = clienteFixture();
    prismaMock.cliente.findFirst.mockResolvedValue(fila);

    await expect(obtenerCliente('cliente-1', 'store-1')).resolves.toEqual(fila);
    expect(prismaMock.cliente.findFirst).toHaveBeenCalledWith({
      where: { id: 'cliente-1', storeId: 'store-1' },
    });
  });

  it('lanza CLIENTE_NOT_FOUND si no pertenece a la tienda', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(null);

    await expectApiError(() => obtenerCliente('cliente-x', 'store-1'), {
      status: 404,
      code: 'CLIENTE_NOT_FOUND',
    });
  });
});

describe('crearCliente', () => {
  it('normaliza el RFC a mayúsculas y audita la creación', async () => {
    const creado = clienteFixture({ id: 'cliente-7', rfc: 'XAXX010101000' });
    prismaMock.cliente.create.mockResolvedValue(creado);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const resultado = await crearCliente('store-1', 'user-1', entrada);

    expect(resultado).toEqual(creado);
    expect(prismaMock.cliente.create).toHaveBeenCalledWith({
      data: { ...entrada, rfc: 'XAXX010101000', storeId: 'store-1' },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'CREATE',
        entity: 'CLIENTE',
        entityId: 'cliente-7',
        metadata: { rfc: 'XAXX010101000', nombre: 'Público en General' },
      },
    });
  });

  it('traduce P2002 a CLIENTE_RFC_DUPLICADO', async () => {
    prismaMock.cliente.create.mockRejectedValue({ code: 'P2002' });

    await expectApiError(() => crearCliente('store-1', 'user-1', entrada), {
      status: 409,
      code: 'CLIENTE_RFC_DUPLICADO',
    });
  });

  it('repropaga errores que no son P2002', async () => {
    const error = new Error('fallo de conexión');
    prismaMock.cliente.create.mockRejectedValue(error);

    await expect(crearCliente('store-1', 'user-1', entrada)).rejects.toBe(error);
  });

  it('repropaga errores sin campo code', async () => {
    const error = { message: 'sin code' };
    prismaMock.cliente.create.mockRejectedValue(error);

    await expect(crearCliente('store-1', 'user-1', entrada)).rejects.toBe(error);
  });

  it('repropaga errores que no son objetos', async () => {
    prismaMock.cliente.create.mockRejectedValue('texto plano');

    await expect(crearCliente('store-1', 'user-1', entrada)).rejects.toBe('texto plano');
  });
});

describe('actualizarCliente', () => {
  it('lanza CLIENTE_NOT_FOUND si el cliente no existe en la tienda', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(null);

    await expectApiError(() => actualizarCliente('cliente-x', 'store-1', 'user-1', {}), {
      status: 404,
      code: 'CLIENTE_NOT_FOUND',
    });
  });

  it('actualiza solo los campos presentes y normaliza el RFC', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(clienteFixture({ id: 'cliente-1' }));
    prismaMock.cliente.update.mockResolvedValue(
      clienteFixture({ id: 'cliente-1', rfc: 'ACME010101000' })
    );
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    await actualizarCliente('cliente-1', 'store-1', 'user-1', {
      rfc: 'acme010101000',
      isActive: false,
    });

    expect(prismaMock.cliente.update).toHaveBeenCalledWith({
      where: { id: 'cliente-1' },
      data: { rfc: 'ACME010101000', isActive: false },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'UPDATE',
        entity: 'CLIENTE',
        entityId: 'cliente-1',
        metadata: { changes: { rfc: 'acme010101000', isActive: false } },
      },
    });
  });

  it('permite desactivar el cliente sin enviar otros campos', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(clienteFixture());
    prismaMock.cliente.update.mockResolvedValue(clienteFixture({ isActive: false }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-3' });

    await actualizarCliente('cliente-1', 'store-1', 'user-1', { isActive: false });

    expect(prismaMock.cliente.update).toHaveBeenCalledWith({
      where: { id: 'cliente-1' },
      data: { isActive: false },
    });
  });

  it('traduce P2002 a CLIENTE_RFC_DUPLICADO', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(clienteFixture());
    prismaMock.cliente.update.mockRejectedValue({ code: 'P2002' });

    await expectApiError(
      () => actualizarCliente('cliente-1', 'store-1', 'user-1', { rfc: 'OTRO010101000' }),
      { status: 409, code: 'CLIENTE_RFC_DUPLICADO' }
    );
  });

  it('actualiza todos los campos cuando se envían completos', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(clienteFixture({ id: 'cliente-1' }));
    prismaMock.cliente.update.mockResolvedValue(clienteFixture({ id: 'cliente-1' }));
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-9' });

    await actualizarCliente('cliente-1', 'store-1', 'user-1', {
      rfc: 'acme010101000',
      nombreRazonSocial: 'ACME SA',
      representanteLegal: 'Ana',
      codigoPostal: '81200',
      regimenFiscal: '601',
      usoCfdi: 'G03',
      email: 'ana@acme.mx',
      phone: '6671234567',
      isActive: true,
    });

    expect(prismaMock.cliente.update).toHaveBeenCalledWith({
      where: { id: 'cliente-1' },
      data: {
        rfc: 'ACME010101000',
        nombreRazonSocial: 'ACME SA',
        representanteLegal: 'Ana',
        codigoPostal: '81200',
        regimenFiscal: '601',
        usoCfdi: 'G03',
        email: 'ana@acme.mx',
        phone: '6671234567',
        isActive: true,
      },
    });
  });
});

describe('eliminarCliente', () => {
  it('lanza CLIENTE_NOT_FOUND si no existe', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(null);

    await expectApiError(() => eliminarCliente('cliente-x', 'store-1', 'user-1'), {
      status: 404,
      code: 'CLIENTE_NOT_FOUND',
    });
  });

  it('bloquea el borrado si tiene facturas emitidas', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(clienteFixture());
    prismaMock.factura.count.mockResolvedValue(2);

    await expectApiError(() => eliminarCliente('cliente-1', 'store-1', 'user-1'), {
      status: 409,
      code: 'CLIENTE_CON_FACTURAS',
    });
    expect(prismaMock.cliente.delete).not.toHaveBeenCalled();
  });

  it('borra físicamente y audita cuando no hay facturas', async () => {
    const existente = clienteFixture({ id: 'cliente-1' });
    prismaMock.cliente.findFirst.mockResolvedValue(existente);
    prismaMock.factura.count.mockResolvedValue(0);
    prismaMock.cliente.delete.mockResolvedValue(existente);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-4' });

    await expect(eliminarCliente('cliente-1', 'store-1', 'user-1')).resolves.toEqual(existente);
    expect(prismaMock.cliente.delete).toHaveBeenCalledWith({ where: { id: 'cliente-1' } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        userId: 'user-1',
        action: 'DELETE',
        entity: 'CLIENTE',
        entityId: 'cliente-1',
        metadata: { rfc: 'XAXX010101000', nombre: 'Público en General' },
      },
    });
  });
});
