import cron from 'node-cron';
import { prisma } from '../config/prisma';
import { autoCloseStoreSessions, buildCronExpression } from './autoClose.service';
import { logger } from '../config/logger';
import { env } from '../config/env';

interface ScheduledJob {
  storeId: string;
  task: cron.ScheduledTask;
}

const jobs = new Map<string, ScheduledJob>();
const TIMEZONE = env.TIMEZONE ?? 'America/Mazatlan';

export async function initScheduler(): Promise<void> {
  const stores = await prisma.store.findMany({
    where: { autoCloseEnabled: true, autoCloseTime: { not: null } },
    select: { id: true, autoCloseTime: true, autoCloseDays: true },
  });

  for (const store of stores) {
    scheduleStoreAutoClose(store.id, store.autoCloseTime!, store.autoCloseDays);
  }

  scheduleExpiredProducts();

  logger.info(`🕐 Scheduler initialized for ${stores.length} store(s)`);
}

export function scheduleStoreAutoClose(
  storeId: string,
  time: string,
  days: string[]
): void {
  if (jobs.has(storeId)) {
    jobs.get(storeId)!.task.stop();
    jobs.delete(storeId);
  }

  const expression = buildCronExpression(time, days);

  const task = cron.schedule(
    expression,
    async () => {
      logger.info(`[AutoClose] Running for store ${storeId}`);
      try {
        const result = await autoCloseStoreSessions(storeId);
        logger.info(`[AutoClose] Store ${storeId}: closed ${result.closed} session(s)`);
      } catch (err) {
        logger.error(`[AutoClose] Store ${storeId} failed:`, err);
      }
    },
    {
      timezone: TIMEZONE,
    }
  );

  jobs.set(storeId, { storeId, task });
  logger.info(`[AutoClose] Scheduled for store ${storeId}: ${expression} (${TIMEZONE})`);
}

export function stopStoreAutoClose(storeId: string): void {
  if (jobs.has(storeId)) {
    jobs.get(storeId)!.task.stop();
    jobs.delete(storeId);
    logger.info(`[AutoClose] Stopped for store ${storeId}`);
  }
}

export function getScheduledStores(): string[] {
  return Array.from(jobs.keys());
}

export function scheduleExpiredProducts(): void {
  cron.schedule(
    '0 8 * * *',
    async () => {
      try {
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const expiring = await prisma.product.findMany({
          where: {
            expirationDate: {
              gte: now,
              lte: sevenDaysFromNow,
            },
          },
          select: {
            id: true,
            name: true,
            expirationDate: true,
            storeId: true,
          },
        });

        const byStore = new Map<string, { productId: string; productName: string; expirationDate: string }[]>();
        for (const p of expiring) {
          const arr = byStore.get(p.storeId) ?? [];
          arr.push({
            productId: p.id,
            productName: p.name,
            expirationDate: p.expirationDate ? p.expirationDate.toISOString().split('T')[0] : '2100-02-02',
          });
          byStore.set(p.storeId, arr);
        }
        for (const [storeId, products] of byStore) {
          // Lazy require to avoid circular dependency with socket.ts.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { emitToStore } = require('../socket/socket');
          emitToStore(storeId, 'inventory:expiration-alert', { products, storeId });
        }
        logger.info(
          `[ExpiredProducts] ${expiring.length} producto(s) próximos a expirar en ${byStore.size} tienda(s)`
        );
      } catch (err) {
        logger.error('[ExpiredProducts] Error al verificar productos proximos a expirar:', err);
      }
    },
    { timezone: TIMEZONE }
  );

  logger.info(`[ExpiredProducts] Job programado diariamente a las 08:00 (${TIMEZONE})`);
}