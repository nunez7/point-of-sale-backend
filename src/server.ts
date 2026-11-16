import express, { type Express } from 'express';

// Entrypoint único: en Vercel (detección zero-config de Express) se consume el default
// export; fuera de Vercel (npm run dev / npm start) además se levanta el servidor HTTP
// con Socket.io y el scheduler.
//
// El arranque de la app se hace con require() dentro de try/catch a propósito: si
// src/config/env.ts lanza por variables inválidas o falta el cliente Prisma, el fallo
// queda capturable aquí y se responde 503 con el detalle. Con imports estáticos el
// módulo entero reventaría y Vercel solo devolvería FUNCTION_INVOCATION_FAILED sin cuerpo.
let appReal: Express | null = null;
let errorArranque: unknown = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  appReal = (require('./app') as typeof import('./app')).app;
} catch (error) {
  errorArranque = error;
  // eslint-disable-next-line no-console
  console.error('[server] Fallo al inicializar la aplicación:', error);
}

function describir(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * App mínima de emergencia: responde 503 con el motivo del fallo en /health y en
 * cualquier otra ruta, en JSON, para poder diagnosticarlo sin abrir los logs.
 */
function crearAppDiagnostico(error: unknown): Express {
  const app = express();

  const cuerpo = {
    status: 'error',
    error: 'La aplicación no pudo inicializarse',
    detalle: describir(error),
  };

  app.get('/health', (_req, res) => {
    res.status(503).json(cuerpo);
  });

  app.use((_req, res) => {
    res.status(503).json(cuerpo);
  });

  return app;
}

const appExportada: Express = appReal ?? crearAppDiagnostico(errorArranque);

export default appExportada;

// En serverless no se abre ningún puerto: la plataforma entrega req/res directamente.
if (!process.env.VERCEL) {
  void iniciarServidorLocal();
}

async function iniciarServidorLocal(): Promise<void> {
  try {
    const http = require('http') as typeof import('http');
    const { env } = require('./config/env') as typeof import('./config/env');
    const { logger } = require('./config/logger') as typeof import('./config/logger');
    const { initSocket } = require('./socket/socket') as typeof import('./socket/socket');
    const { prisma } = require('./config/prisma') as typeof import('./config/prisma');
    const { initScheduler } = require('./services/scheduler.service') as typeof import('./services/scheduler.service');

    if (!appReal) {
      logger.error(
        'No se inicia el servidor: la aplicación falló al inicializar (revisa las variables de entorno).',
      );
      process.exitCode = 1;
      return;
    }

    await prisma.$connect();
    logger.info('✅ PostgreSQL conectado');

    await initScheduler();

    const server = http.createServer(appReal);
    initSocket(server);

    const listenOptions = env.HOST ? { port: env.PORT, host: env.HOST } : { port: env.PORT };

    server.listen(listenOptions, () => {
      logger.info(
        `🚀 API Punto-Venta corriendo en http://${env.HOST ?? 'localhost'}:${env.PORT}`,
      );
      logger.info(`   Health: http://${env.HOST ?? 'localhost'}:${env.PORT}/health`);
      logger.info(`   CORS permitido: ${env.CORS_ORIGIN}`);
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
    // eslint-disable-next-line no-console
    console.error('[server] Error al iniciar el servidor local:', err);
    process.exitCode = 1;
  }
}
