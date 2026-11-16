/**
 * Configuración del listener HTTP **local** (`npm run dev` / `npm start`).
 *
 * `PORT` y `HOST` NO forman parte de `env.ts` a propósito: en un hosting serverless
 * (Vercel) no se abre ningún puerto — la plataforma entrega cada request directamente
 * a la función y el puerto lo administra ella. Validarlos ahí solo servía para que un
 * `PORT` heredado o mal copiado en el dashboard tumbara la función entera.
 */
export interface OpcionesDeEscucha {
  port: number;
  host?: string;
}

const PUERTO_POR_DEFECTO = 3001;

export function opcionesDeEscucha(): OpcionesDeEscucha {
  const puertoCrudo = process.env.PORT?.trim();
  const port = puertoCrudo ? Number(puertoCrudo) : PUERTO_POR_DEFECTO;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `PORT inválido: "${puertoCrudo}". Debe ser un entero entre 1 y 65535 (solo aplica en local; ` +
        'en Vercel el puerto lo asigna la plataforma y esta variable no se usa).',
    );
  }

  const host = process.env.HOST?.trim() || undefined;

  return host ? { port, host } : { port };
}
