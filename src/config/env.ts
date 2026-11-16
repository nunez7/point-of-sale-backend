import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3001),
    // Interfaz de escucha. Sin valor = todas las interfaces (comportamiento por defecto de Node).
    // '127.0.0.1' = solo este equipo; la IP de una interfaz concreta = solo esa red.
    HOST: z.string().trim().optional(),
    // Número de saltos de proxy de confianza para resolver req.ip (0 = sin proxy).
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    // Lista de IPs autorizadas (separadas por coma). Admite comodín de sufijo: '192.168.1.*'.
    // Vacía = sin restricción por IP (no permitido en producción con la restricción activa).
    ALLOWED_IPS: z
      .string()
      .default('127.0.0.1,::1')
      .transform((value) =>
        value
          .split(',')
          .map((ip) => ip.trim())
          .filter(Boolean),
      ),
    // Interruptor de la restricción por IP. En hostings serverless (Vercel, etc.) la IP
    // de origen cambia en cada petición, así que no se puede mantener una allowlist:
    // con 'false' el middleware y el handshake de Socket.io dejan pasar todo.
    // Se parsea explícitamente porque z.coerce.boolean() convierte 'false' en true.
    IP_ALLOWLIST_ENABLED: z
      .enum(['true', 'false', '1', '0'])
      .default('true')
      .transform((value) => value === 'true' || value === '1'),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
    JWT_EXPIRES_IN: z.string().default('8h'),
    CORS_ORIGIN: z.string().default('*'),
    SOCKET_CORS_ORIGIN: z.string().default('*'),
    DB_POOL_MAX: z.coerce.number().default(10),
    DB_POOL_IDLE_TIMEOUT: z.coerce.number().default(30000),
    TIMEZONE: z.string().default('America/Mazatlan'),
  })
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production' && data.CORS_ORIGIN === '*') return false;
      return true;
    },
    { message: 'CORS_ORIGIN no puede ser "*" en producción', path: ['CORS_ORIGIN'] },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production' && data.SOCKET_CORS_ORIGIN === '*') return false;
      return true;
    },
    { message: 'SOCKET_CORS_ORIGIN no puede ser "*" en producción', path: ['SOCKET_CORS_ORIGIN'] },
  )
  .refine(
    (data) => {
      if (!data.IP_ALLOWLIST_ENABLED) return true;
      if (data.NODE_ENV === 'production' && data.ALLOWED_IPS.length === 0) return false;
      return true;
    },
    {
      message:
        'ALLOWED_IPS no puede estar vacío en producción (usa IP_ALLOWLIST_ENABLED=false si el hosting no permite allowlist)',
      path: ['ALLOWED_IPS'],
    },
  )
  .refine(
    (data) => {
      if (!data.IP_ALLOWLIST_ENABLED) return true;
      if (data.NODE_ENV === 'production' && data.ALLOWED_IPS.includes('*')) return false;
      return true;
    },
    { message: 'ALLOWED_IPS no puede contener "*" en producción', path: ['ALLOWED_IPS'] },
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