import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { prismaMock } from './helpers/prismaMock';

/**
 * Verifica la infraestructura de la suite (no cubre código de src/):
 * que el cliente Prisma generado se pueda importar sin conexión y que el doble
 * de tests soporte las tres formas de transacción que usa el backend.
 */
describe('infraestructura de pruebas', () => {
  it('expone Prisma.Decimal real sin abrir conexión a la base', () => {
    expect(new Prisma.Decimal('10.005').toFixed(2)).toBe('10.01');
  });

  it('el mock de Prisma crea métodos por demanda y los reutiliza', () => {
    const primera = prismaMock.product.findMany;
    const segunda = prismaMock.product.findMany;

    expect(primera).toBe(segunda);
    expect(prismaMock.otroModelo.findFirst).toBeDefined();
  });

  it('$transaction ejecuta el callback pasándose a sí mismo como tx', async () => {
    prismaMock.sale.create.mockResolvedValue({ id: 'sale-1' });

    const resultado = await prismaMock.$transaction(async (tx: typeof prismaMock) => {
      return tx.sale.create({ data: {} });
    });

    expect(resultado).toEqual({ id: 'sale-1' });
    expect(prismaMock.sale.create).toHaveBeenCalledTimes(1);
  });

  it('$transaction acepta un array de promesas', async () => {
    prismaMock.inventory.findMany.mockResolvedValue([]);
    prismaMock.inventory.count.mockResolvedValue(0);

    const [filas, total] = await prismaMock.$transaction([
      prismaMock.inventory.findMany(),
      prismaMock.inventory.count(),
    ]);

    expect(filas).toEqual([]);
    expect(total).toBe(0);
  });

  it('$queryRaw funciona como tagged template y devuelve un array por defecto', async () => {
    const filas = await prismaMock.$queryRaw`SELECT id FROM "inventory" WHERE "storeId" = ${'store-1'}`;

    expect(filas).toEqual([]);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
