import { prisma } from '../config/prisma';
import { Prisma } from '../../generated/prisma/client.js';

interface AuditInput {
  storeId: string;
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        storeId: input.storeId,
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        metadata: input.metadata,
      },
    });
  } catch (err) {
    // Audit logging must never break the main flow
    // eslint-disable-next-line no-console
    console.error('Audit log failed:', err);
  }
}

export async function auditTx(
  tx: Prisma.TransactionClient,
  input: AuditInput
): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        storeId: input.storeId,
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        metadata: input.metadata,
      },
    });
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}