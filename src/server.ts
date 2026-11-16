import http from 'http';
import { app } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { initSocket } from './socket/socket';
import { prisma } from './config/prisma';
import { initScheduler } from './services/scheduler.service';

async function start(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('✅ PostgreSQL conectado');

    await initScheduler();

    const server = http.createServer(app);
    initSocket(server);

    const listenOptions = env.HOST ? { port: env.PORT, host: env.HOST } : { port: env.PORT };

    server.listen(listenOptions, () => {
      logger.info(
        `🚀 API Punto-Venta corriendo en http://${env.HOST ?? 'localhost'}:${env.PORT}`,
      );
      logger.info(`   Health: http://${env.HOST ?? 'localhost'}:${env.PORT}/health`);
      logger.info(`   IPs autorizadas: ${env.ALLOWED_IPS.join(', ') || 'todas (sin restricción)'}`);
    });

    const shutdown = async (signal: string) => {
      logger.info(`Recibido ${signal}, cerrando servidor...`);
      server.close(async () => {
        await prisma.$disconnect().catch(() => undefined);
        process.exit(0);
      });
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Error al iniciar el servidor:', err);
    process.exit(1);
  }
}

void start();