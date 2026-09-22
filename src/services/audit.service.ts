import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';
import { mexicoStartOfDay, mexicoEndOfDay } from '../utils/dates';

export interface AuditLogFilters {
  startDate?: string;
  endDate?: string;
  entity?: string;
  action?: string;
  userId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

interface AuditLogSerialized {
  id: string;
  storeId: string;
  userId: string | null;
  user: { id: string; name: string; email: string } | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

function serializeLog(log: {
  id: string;
  storeId: string;
  userId: string | null;
  user: { id: string; name: string; email: string } | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Prisma.InputJsonValue | null;
  createdAt: Date;
}): AuditLogSerialized {
  return {
    id: log.id,
    storeId: log.storeId,
    userId: log.userId,
    user: log.user,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId,
    metadata: log.metadata as Record<string, unknown> | null,
    createdAt: log.createdAt.toISOString(),
  };
}

export async function listAuditLogs(
  storeId: string,
  filters?: AuditLogFilters
): Promise<{ logs: AuditLogSerialized[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters?.pageSize ?? 50));
  const skip = (page - 1) * pageSize;

  const where: Prisma.AuditLogWhereInput = { storeId };

  // Date range filter
  if (filters?.startDate || filters?.endDate) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.startDate) createdAt.gte = mexicoStartOfDay(filters.startDate);
    if (filters.endDate) createdAt.lte = mexicoEndOfDay(filters.endDate);
    where.createdAt = createdAt;
  }

  // Entity filter
  if (filters?.entity) {
    where.entity = filters.entity;
  }

  // Action filter
  if (filters?.action) {
    where.action = filters.action;
  }

  // User filter
  if (filters?.userId) {
    where.userId = filters.userId;
  }

  // Search filter (user name or email)
  if (filters?.search) {
    where.user = {
      OR: [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ],
    };
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs: logs.map(serializeLog),
    total,
    page,
    pageSize,
  };
}
