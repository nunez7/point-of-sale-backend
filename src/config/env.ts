import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Variables que la API necesita en CUALQUIER entorno (local y serverless).
// PORT y HOST no están aquí: son exclusivos del listener local, ver src/config/listen.ts.
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
    JWT_EXPIRES_IN: z.string().default('8h'),
    // Único origen(es) autorizados por CORS: HTTP y Socket.io comparten esta lista.
    // Admite lista separada por comas de orígenes exactos (sin comodines salvo '*' en dev).
    CORS_ORIGIN: z.string().default('*'),
    DB_POOL_MAX: z.coerce.number().default(10),
    DB_POOL_IDLE_TIMEOUT: z.coerce.number().default(30000),
    TIMEZONE: z.string().default('America/Mazatlan'),
    // Licenciamiento on-premise. El backend SOLO verifica con la llave pública
    // (PEM RSA); la llave privada vive en el emisor (tools/emisor-licencias) y
    // nunca se despliega. Sin llave pública no hay verificación posible y el
    // modo efectivo es 'off'.
    LICENCIA_PUBLIC_KEY: z.string().optional(),
    // off   = no se valida nada (desarrollo local)
    // soft  = se calcula el estado y se avisa, pero NUNCA se bloquea
    // hard  = se bloquea la creación/apertura de cajas al vencer
    LICENCIA_ENFORCEMENT: z.enum(['off', 'soft', 'hard']).default('off'),
  })
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production' && data.CORS_ORIGIN === '*') return false;
      return true;
    },
    { message: 'CORS_ORIGIN no puede ser "*" en producción', path: ['CORS_ORIGIN'] },
  );

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Se lanza un Error (en lugar de process.exit) para que el mensaje llegue íntegro a los
  // logs; en un runtime serverless process.exit solo produce FUNCTION_INVOCATION_FAILED y
  // se pierde el detalle de qué variable falta o es inválida.
  const detalles = Object.entries(parsed.error.flatten().fieldErrors)
    .map(([campo, mensajes]) => `  - ${campo}: ${(mensajes ?? []).join('; ')}`)
    .join('\n');

  const mensaje =
    `Variables de entorno inválidas:\n${detalles}\n` +
    'Revisa el archivo .env (desarrollo) o las Environment Variables del hosting (producción).';

  // eslint-disable-next-line no-console
  console.error(`❌ ${mensaje}`);
  throw new Error(mensaje);
}

export const env = parsed.data;
