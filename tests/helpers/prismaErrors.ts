import { Prisma } from '../../generated/prisma/client.js';

/**
 * Construye un error real de Prisma para probar las ramas que usan
 * `instanceof Prisma.PrismaClientKnownRequestError` (p. ej. P2002 duplicado).
 */
export function prismaKnownError(
  code: string,
  meta?: Record<string, unknown>
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Error de Prisma simulado', {
    code,
    clientVersion: '7.10.0',
    meta,
  });
}
