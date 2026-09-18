import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3001),
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
  );

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;