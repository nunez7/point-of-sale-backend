// Entrypoint para el runtime serverless de Vercel (api/index.ts → /api y raíz).
//
// Objetivo: que un fallo de arranque deje de ser opaco. Vercel convierte cualquier
// excepción de módulo en un 500 "FUNCTION_INVOCATION_FAILED" sin cuerpo; aquí se captura
// ese fallo y se responde con el detalle (variables de entorno faltantes, módulo no
// encontrado, etc.) para poder diagnosticar con un simple curl.
//
// Nota: este archivo queda FUERA de tsconfig (include: src/**/*.ts) a propósito; Vercel lo
// transpila por su cuenta. Para un despliegue tradicional sigue usándose src/server.ts.
import type { IncomingMessage, ServerResponse } from 'http';
import type { Express } from 'express';
import express from 'express';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let appCache: Express | null = null;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * App mínima de emergencia: responde 503 con el motivo del fallo en /health y en
 * cualquier otra ruta, en JSON, para que el navegador y curl puedan leerlo.
 */
function appDeDiagnostico(error: unknown): Express {
  const app = express();

  const cuerpo = {
    status: 'error',
    error: 'La aplicación no pudo inicializarse',
    detalle: describeError(error),
  };

  app.get('/health', (_req, res) => {
    res.status(503).json(cuerpo);
  });

  app.use((_req, res) => {
    res.status(503).json(cuerpo);
  });

  return app;
}

/**
 * Carga la app real de forma diferida: un fallo aquí (env inválido, cliente Prisma sin
 * generar, dependencia ausente) queda capturable en el handler. Se usa require para que
 * el bundler de Vercel resuelva la ruta sin extensión; con `import()` dinámico en un
 * módulo CommonJS, TypeScript exige extensión .js.
 */
function obtenerApp(): Express {
  if (appCache) return appCache;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('../src/app') as { app: Express };
  appCache = app;
  return app;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  try {
    const app = obtenerApp();
    (app as unknown as Handler)(req, res);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api/index] Fallo al inicializar la aplicación:', error);
    const app = appDeDiagnostico(error);
    (app as unknown as Handler)(req, res);
  }
}
