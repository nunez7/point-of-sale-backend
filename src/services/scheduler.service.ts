import cron from 'node-cron';
import { prisma } from '../config/prisma';
import { autoCloseStoreSessions, buildCronExpression } from './autoClose.service';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { emitToStore } from '../socket/socket';

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

  scheduleExpiredPromotions();

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

function scheduleExpiredPromotions(): void {
  cron.schedule(
    '*/1 * * * *',
    async () => {
      try {
        const now = new Date();
        const expired = await prisma.promotion.findMany({
          where: { isActive: true, endsAt: { lt: now } },
          select: { id: true, storeId: true },
        });
        if (expired.length === 0) return;

        await prisma.promotion.updateMany({
          where: { id: { in: expired.map((p) => p.id) } },
          data: { isActive: false },
        });

        const byStore = new Map<string, string[]>();
        for (const p of expired) {
          const arr = byStore.get(p.storeId) ?? [];
          arr.push(p.id);
          byStore.set(p.storeId, arr);
        }
        for (const [storeId, ids] of byStore) {
          emitToStore(storeId, 'promotions:bulk-expired', { ids });
        }
        logger.info(
          `[ExpiredPromos] Desactivadas ${expired.length} promoción(es) vencida(s) en ${byStore.size} tienda(s)`
        );
      } catch (err) {
        logger.error('[ExpiredPromos] Error al desactivar promociones vencidas:', err);
      }
    },
    { timezone: TIMEZONE }
  );

  logger.info(`[ExpiredPromos] Job programado cada 1 minuto (${TIMEZONE})`);
}