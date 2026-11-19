import { defineConfig } from 'vitest/config';

// Configuración de la suite de pruebas del backend.
// Los tests viven en tests/ (fuera de tsconfig.include) para no alterar
// `npm run build`, que solo compila src/.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Cada test parte de un mock de Prisma limpio (ver tests/helpers/prismaMock.ts).
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    // Variables mínimas para que src/config/env.ts valide sin leer .env.
    // DATABASE_URL es ficticia: src/config/prisma.ts siempre está mockeado.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/punto-venta-test',
      JWT_SECRET: 'secreto-de-pruebas-con-mas-de-32-caracteres',
      JWT_EXPIRES_IN: '8h',
      CORS_ORIGIN: '*',
      TIMEZONE: 'America/Mazatlan',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/services/**/*.ts'],
      exclude: ['src/services/**/*.d.ts'],
      // Gate de cobertura: 90% en los cuatro ejes sobre src/services/**.
      // Cobertura actual: 99.56 stmts / 97.51 branches / 100 funcs / 99.86 lines.
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
