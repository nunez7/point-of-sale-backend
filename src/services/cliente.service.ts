import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';

export interface ClienteInput {
  rfc: string;
  nombreRazonSocial: string;
  representanteLegal?: string | null;
  codigoPostal: string;
  regimenFiscal: string;
  usoCfdi?: string | null;
  email?: string | null;
  phone?: string | null;
}

export type ClienteUpdateInput = Partial<ClienteInput>;

function mapearErrorRfcDuplicado(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  ) {
    return ApiError.conflict(
      'Ya existe un cliente registrado con ese RFC',
      'CLIENTE_RFC_DUPLICADO'
    );
  }
  return error;
}

export async function listarClientes(storeId: string, search?: string) {
  const where: Record<string, unknown> = { storeId, isActive: true };

  const termino = search?.trim();
  if (termino) {
    where.OR = [
      { rfc: { contains: termino, mode: 'insensitive' } },
      { nombreRazonSocial: { contains: termino, mode: 'insensitive' } },
    ];
  }

  return prisma.cliente.findMany({
    where,
    orderBy: { nombreRazonSocial: 'asc' },
    take: 100,
  });
}

export async function obtenerCliente(id: string, storeId: string) {
  const cliente = await prisma.cliente.findFirst({ where: { id, storeId } });
  if (!cliente) {
    throw ApiError.notFound('Cliente no encontrado', 'CLIENTE_NOT_FOUND');
  }
  return cliente;
}

export async function crearCliente(storeId: string, userId: string, data: ClienteInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.create({
        data: { ...data, rfc: data.rfc.toUpperCase(), storeId },
      });

      await tx.auditLog.create({
        data: {
          storeId,
          userId,
          action: 'CREATE',
          entity: 'CLIENTE',
          entityId: cliente.id,
          metadata: { rfc: cliente.rfc, nombre: cliente.nombreRazonSocial },
        },
      });

      return cliente;
    });
  } catch (error) {
    throw mapearErrorRfcDuplicado(error);
  }
}

export async function actualizarCliente(
  id: string,
  storeId: string,
  userId: string,
  data: ClienteUpdateInput
) {
  const existente = await prisma.cliente.findFirst({ where: { id, storeId } });
  if (!existente) {
    throw ApiError.notFound('Cliente no encontrado', 'CLIENTE_NOT_FOUND');
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.update({
        where: { id },
        data: {
          ...(data.rfc !== undefined && { rfc: data.rfc.toUpperCase() }),
          ...(data.nombreRazonSocial !== undefined && { nombreRazonSocial: data.nombreRazonSocial }),
          ...(data.representanteLegal !== undefined && { representanteLegal: data.representanteLegal }),
          ...(data.codigoPostal !== undefined && { codigoPostal: data.codigoPostal }),
          ...(data.regimenFiscal !== undefined && { regimenFiscal: data.regimenFiscal }),
          ...(data.usoCfdi !== undefined && { usoCfdi: data.usoCfdi }),
          ...(data.email !== undefined && { email: data.email }),
          ...(data.phone !== undefined && { phone: data.phone }),
        },
      });

      await tx.auditLog.create({
        data: {
          storeId,
          userId,
          action: 'UPDATE',
          entity: 'CLIENTE',
          entityId: cliente.id,
          metadata: { changes: data as Prisma.InputJsonValue },
        },
      });

      return cliente;
    });
  } catch (error) {
    throw mapearErrorRfcDuplicado(error);
  }
}

export async function eliminarCliente(id: string, storeId: string, userId: string) {
  const existente = await prisma.cliente.findFirst({ where: { id, storeId } });
  if (!existente) {
    throw ApiError.notFound('Cliente no encontrado', 'CLIENTE_NOT_FOUND');
  }

  return prisma.$transaction(async (tx) => {
    // Borrado lógico: las facturas emitidas conservan la referencia al receptor.
    const cliente = await tx.cliente.update({
      where: { id },
      data: { isActive: false },
    });

    await tx.auditLog.create({
      data: {
        storeId,
        userId,
        action: 'DELETE',
        entity: 'CLIENTE',
        entityId: cliente.id,
        metadata: { rfc: cliente.rfc, nombre: cliente.nombreRazonSocial },
      },
    });

    return cliente;
  });
}
