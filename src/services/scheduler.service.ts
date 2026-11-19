import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../config/prisma';
import { emitToStore } from '../socket/socket';
import { autoCloseStoreSessions, buildCronExpression } from './autoClose.service';
import { logger } from '../config/logger';
import { env } from '../config/env';

interface ScheduledJob {
  storeId: string;
  task: ScheduledTask;
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
        const dias = 7;
        const hoy = new Date();
        const inicioHoy = new Date(
          Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate())
        );
        const limite = new Date(inicioHoy.getTime() + dias * 24 * 60 * 60 * 1000);

        // Se revisan lotes con saldo (no la caducidad del producto): un mismo
        // producto puede tener varios lotes con fechas distintas, y solo
        // interesa avisar de los que todavía tienen mercancía.
        const lotes = await prisma.inventoryLot.findMany({
          where: {
            availableQty: { gt: 0 },
            expirationDate: { not: null, lte: limite },
          },
          include: { product: { select: { name: true, sku: true } } },
          orderBy: [{ expirationDate: 'asc' }],
        });

        interface LoteAlerta {
          lotId: string;
          productId: string;
          productName: string;
          sku: string | null;
          availableQty: number;
          expirationDate: string;
          diasParaVencer: number;
        }

        const porTienda = new Map<string, LoteAlerta[]>();
        for (const lote of lotes) {
          if (!lote.expirationDate) continue;
          const diasRestantes = Math.round(
            (lote.expirationDate.getTime() - inicioHoy.getTime()) / (24 * 60 * 60 * 1000)
          );
          const arr = porTienda.get(lote.storeId) ?? [];
          arr.push({
            lotId: lote.id,
            productId: lote.productId,
            productName: lote.product.name,
            sku: lote.product.sku,
            availableQty: Number(lote.availableQty),
            expirationDate: lote.expirationDate.toISOString().slice(0, 10),
            diasParaVencer: diasRestantes,
          });
          porTienda.set(lote.storeId, arr);
        }

        for (const [storeId, detalle] of porTienda) {
          emitToStore(storeId, 'inventory:expiration-alert', {
            storeId,
            dias,
            lots: detalle,
            caducados: detalle.filter((l) => l.diasParaVencer < 0),
            porVencer: detalle.filter((l) => l.diasParaVencer >= 0),
          });
        }

        logger.info(
          `[ExpiredProducts] ${lotes.length} lote(s) próximos a expirar en ${porTienda.size} tienda(s)`
        );
      } catch (err) {
        logger.error('[ExpiredProducts] Error al verificar lotes próximos a expirar:', err);
      }
    },
    { timezone: TIMEZONE }
  );

  logger.info(`[ExpiredProducts] Job programado diariamente a las 08:00 (${TIMEZONE})`);
}