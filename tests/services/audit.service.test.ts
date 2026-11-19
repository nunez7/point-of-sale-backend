import { describe, expect, it } from 'vitest';
import { prismaMock } from '../helpers/prismaMock';
import { listAuditLogs } from '../../src/services/audit.service';
import { mexicoEndOfDay, mexicoStartOfDay } from '../../src/utils/dates';

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-1',
    storeId: 'store-1',
    userId: 'user-1',
    user: { id: 'user-1', name: 'Vendedor', email: 'v@servicaja.com' },
    action: 'CREATE',
    entity: 'SALE',
    entityId: 'sale-1',
    metadata: { total: 100 },
    createdAt: new Date('2026-01-15T18:00:00.000Z'),
    ...overrides,
  };
}

function argsDe(fn: { mock: { calls: unknown[][] } }) {
  return fn.mock.calls[0]?.[0] as {
    where: Record<string, any>;
    skip: number;
    take: number;
  };
}

describe('listAuditLogs', () => {
  it('aplica paginación por defecto y serializa las fechas', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([logRow()]);
    prismaMock.auditLog.count.mockResolvedValue(1);

    const resultado = await listAuditLogs('store-1');

    expect(resultado).toEqual({
      logs: [
        {
          id: 'audit-1',
          storeId: 'store-1',
          userId: 'user-1',
          user: { id: 'user-1', name: 'Vendedor', email: 'v@servicaja.com' },
          action: 'CREATE',
          entity: 'SALE',
          entityId: 'sale-1',
          metadata: { total: 100 },
          createdAt: '2026-01-15T18:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    const args = argsDe(prismaMock.auditLog.findMany);
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
  });

  it('normaliza page y limita pageSize a 100', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);

    const resultado = await listAuditLogs('store-1', { page: 0, pageSize: 500 });

    expect(resultado.page).toBe(1);
    expect(resultado.pageSize).toBe(100);
    const args = argsDe(prismaMock.auditLog.findMany);
    expect(args.skip).toBe(0);
    expect(args.take).toBe(100);
  });

  it('calcula el skip según la página', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(120);

    const resultado = await listAuditLogs('store-1', { page: 3, pageSize: 20 });

    expect(resultado.page).toBe(3);
    const args = argsDe(prismaMock.auditLog.findMany);
    expect(args.skip).toBe(40);
  });

  it('filtra por rango de fechas en día de negocio', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);

    await listAuditLogs('store-1', { startDate: '2026-01-01', endDate: '2026-01-31' });

    const args = argsDe(prismaMock.auditLog.findMany);
    expect(args.where.createdAt).toEqual({
      gte: mexicoStartOfDay('2026-01-01'),
      lte: mexicoEndOfDay('2026-01-31'),
    });
  });

  it('filtra solo por fecha de inicio', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);

    await listAuditLogs('store-1', { startDate: '2026-01-01' });

    const args = argsDe(prismaMock.auditLog.findMany);
    expect(args.where.createdAt).toEqual({ gte: mexicoStartOfDay('2026-01-01') });
  });

  it('aplica los filtros de entidad, acción y usuario', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);

    await listAuditLogs('store-1', { entity: 'SALE', action: 'CREATE', userId: 'user-1' });

    const args = argsDe(prismaMock.auditLog.findMany);
    expect(args.where).toEqual({
      storeId: 'store-1',
      entity: 'SALE',
      action: 'CREATE',
      userId: 'user-1',
    });
  });

  it('busca por nombre o email del usuario', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);

    await listAuditLogs('store-1', { search: 'felix' });

    const args = argsDe(prismaMock.auditLog.findMany);
    expect(args.where.user).toEqual({
      OR: [
        { name: { contains: 'felix', mode: 'insensitive' } },
        { email: { contains: 'felix', mode: 'insensitive' } },
      ],
    });
  });

  it('cuenta con el mismo where que la consulta', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);

    await listAuditLogs('store-1', { entity: 'SALE' });

    expect(prismaMock.auditLog.count).toHaveBeenCalledWith({
      where: { storeId: 'store-1', entity: 'SALE' },
    });
  });
});
