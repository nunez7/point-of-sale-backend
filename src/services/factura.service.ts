import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError';
import { mexicoStartOfDay, mexicoEndOfDay } from '../utils/dates';

type Tx = Prisma.TransactionClient;

export interface EmitirFacturaInput {
  storeId: string;
  userId: string;
  ventaId?: string;
  saleNumber?: string;
  clienteId: string;
  usoCfdi: string;
}

async function generarFolio(tx: Tx, storeId: string, code: string): Promise<string> {
  const store = await tx.store.update({
    where: { id: storeId },
    data: { facturaSequence: { increment: 1 } },
  });
  return `${code}-F${String(store.facturaSequence).padStart(4, '0')}`;
}

function validarDatosFiscalesEmisor(store: {
  name: string;
  rfc: string | null;
  regimenFiscal: string | null;
  codigoPostal: string | null;
}): void {
  const faltantes: string[] = [];
  if (!store.rfc) faltantes.push('RFC');
  if (!store.regimenFiscal) faltantes.push('Régimen fiscal');
  if (!store.codigoPostal) faltantes.push('Código postal');

  if (faltantes.length > 0) {
    throw ApiError.badRequest(
      `Los datos fiscales del emisor están incompletos. Faltan: ${faltantes.join(', ')}`,
      'DATOS_FISCALES_INCOMPLETOS'
    );
  }
}

// Busca la venta por número (STORE001-0001) dentro de la tienda del
// usuario y devuelve el resumen para llenar el formulario de factura.
export async function buscarVentaPorNumero(saleNumber: string, storeId: string) {
  const venta = saleNumber.trim().toUpperCase();

  const sale = await prisma.sale.findFirst({
    where: { saleNumber: venta, storeId },
    include: { items: { select: { quantity: true } } },
  });
  if (!sale) {
    throw ApiError.notFound(
      `No existe una venta con el número ${venta}`,
      'VENTA_NOT_FOUND'
    );
  }

  const factura = await prisma.factura.findUnique({
    where: { saleId: sale.id },
    select: { id: true, folio: true, status: true, createdAt: true },
  });

  return {
    id: sale.id,
    saleNumber: sale.saleNumber,
    fecha: sale.createdAt,
    subtotal: Number(sale.subtotal),
    descuento: Number(sale.discount),
    total: Number(sale.total),
    articulos: sale.items.reduce((acc, item) => acc + Number(item.quantity), 0),
    estado: sale.status,
    factura,
  };
}

export async function emitirFactura(input: EmitirFacturaInput) {
  return prisma.$transaction(async (tx) => {
    const criterio = input.ventaId
      ? { id: input.ventaId }
      : { saleNumber: input.saleNumber!.trim().toUpperCase() };

    const sale = await tx.sale.findFirst({
      where: { ...criterio, storeId: input.storeId, status: 'COMPLETED' },
    });
    if (!sale) {
      throw ApiError.notFound('Venta no encontrada o cancelada', 'VENTA_NOT_FOUND');
    }

    const facturaExistente = await tx.factura.findUnique({ where: { saleId: sale.id } });
    if (facturaExistente) {
      if (facturaExistente.status === 'EMITIDA') {
        throw ApiError.conflict(
          `La venta ${sale.saleNumber} ya tiene una factura emitida (${facturaExistente.folio})`,
          'VENTA_YA_FACTURADA'
        );
      }
      throw ApiError.badRequest(
        `La venta ${sale.saleNumber} ya tuvo una factura cancelada (${facturaExistente.folio}); no puede volver a facturarse`,
        'VENTA_CON_FACTURA_CANCELADA'
      );
    }

    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store) throw ApiError.notFound('Tienda no encontrada', 'STORE_NOT_FOUND');
    validarDatosFiscalesEmisor(store);

    const cliente = await tx.cliente.findFirst({
      where: { id: input.clienteId, storeId: input.storeId },
    });
    if (!cliente) {
      throw ApiError.notFound('Cliente no encontrado', 'CLIENTE_NOT_FOUND');
    }
    if (!cliente.isActive) {
      throw ApiError.badRequest('El cliente está inactivo', 'CLIENTE_INACTIVO');
    }

    const folio = await generarFolio(tx, input.storeId, store.code);

    const factura = await tx.factura.create({
      data: {
        folio,
        storeId: input.storeId,
        saleId: sale.id,
        clienteId: cliente.id,
        userId: input.userId,
        emisorRfc: store.rfc!,
        emisorNombre: store.name,
        emisorRegimenFiscal: store.regimenFiscal!,
        emisorCodigoPostal: store.codigoPostal!,
        receptorRfc: cliente.rfc,
        receptorNombre: cliente.nombreRazonSocial,
        receptorCodigoPostal: cliente.codigoPostal,
        receptorRegimenFiscal: cliente.regimenFiscal,
        usoCfdi: input.usoCfdi,
        subtotal: sale.subtotal,
        descuento: sale.discount,
        total: sale.total,
      },
    });

    await tx.auditLog.create({
      data: {
        storeId: input.storeId,
        userId: input.userId,
        action: 'CREATE',
        entity: 'FACTURA',
        entityId: factura.id,
        metadata: {
          folio,
          venta: sale.saleNumber,
          total: sale.total.toString(),
          receptorRfc: cliente.rfc,
          usoCfdi: input.usoCfdi,
        },
      },
    });

    return {
      id: factura.id,
      folio: factura.folio,
      venta: sale.saleNumber,
      total: Number(sale.total),
      usoCfdi: factura.usoCfdi,
      createdAt: factura.createdAt,
    };
  });
}

export interface FacturaFiltros {
  startDate?: string;
  endDate?: string;
  status?: string;
}

export async function listarFacturas(storeId: string, filtros?: FacturaFiltros) {
  const where: Record<string, unknown> = { storeId };

  if (filtros?.status) where.status = filtros.status;

  if (filtros?.startDate || filtros?.endDate) {
    const createdAt: Record<string, Date> = {};
    if (filtros.startDate) createdAt.gte = mexicoStartOfDay(filtros.startDate);
    if (filtros.endDate) createdAt.lte = mexicoEndOfDay(filtros.endDate);
    if (Object.keys(createdAt).length) where.createdAt = createdAt;
  }

  return prisma.factura.findMany({
    where,
    include: {
      cliente: { select: { id: true, rfc: true, nombreRazonSocial: true } },
      sale: { select: { id: true, saleNumber: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function obtenerFactura(id: string, storeId: string) {
  const factura = await prisma.factura.findFirst({
    where: { id, storeId },
    include: {
      cliente: true,
      sale: {
        select: {
          id: true,
          saleNumber: true,
          createdAt: true,
          items: {
            select: {
              quantity: true,
              unitPrice: true,
              product: { select: { name: true } },
            },
          },
        },
      },
      user: { select: { id: true, name: true } },
    },
  });
  if (!factura) {
    throw ApiError.notFound('Factura no encontrada', 'FACTURA_NOT_FOUND');
  }
  // Decimal → número al borde del servicio para que el frontend lo consuma.
  return {
    ...factura,
    subtotal: Number(factura.subtotal),
    descuento: Number(factura.descuento),
    total: Number(factura.total),
    sale: {
      ...factura.sale,
      items: factura.sale.items.map((it) => ({
        ...it,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
      })),
    },
  };
}

export async function cancelarFactura(
  id: string,
  storeId: string,
  userId: string,
  cancellationReasonId?: string,
  comment?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const factura = await tx.factura.findFirst({
      where: { id, storeId, status: 'EMITIDA' },
    });
    if (!factura) {
      throw ApiError.notFound('Factura no encontrada o ya cancelada', 'FACTURA_NOT_FOUND');
    }

    const cancelada = await tx.factura.update({
      where: { id },
      data: {
        status: 'CANCELADA',
        canceledAt: new Date(),
        canceledBy: userId,
        ...(cancellationReasonId && { cancellationReasonId }),
        ...(comment !== undefined && { cancellationComment: comment }),
      },
    });

    // Create Cancellation record if reason provided
    if (cancellationReasonId) {
      await tx.cancellation.create({
        data: {
          storeId,
          userId,
          entityType: 'FACTURA',
          entityId: id,
          entityNumber: factura.folio,
          total: factura.total,
          type: 'FULL',
          cancellationReasonId,
          comment: comment ?? null,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'CANCEL_FACTURA',
        entity: 'FACTURA',
        entityId: id,
        metadata: {
          folio: factura.folio,
          ...(cancellationReasonId && { cancellationReasonId }),
          ...(comment && { comment }),
        },
      },
    });

    return cancelada;
  });
}
