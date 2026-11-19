import { beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './helpers/prismaMock';
import { resetFixtureIds } from './helpers/fixtures';

// Prisma nunca se conecta en pruebas: el módulo que crea el cliente real
// (con PrismaPg y DATABASE_URL) se reemplaza por el doble de tests/helpers.
vi.mock('../src/config/prisma', () => ({ prisma: prismaMock }));

// Socket.io tampoco se inicializa; los servicios solo emiten eventos.
vi.mock('../src/socket/socket', () => ({
  emitToStore: vi.fn(),
  emitToStoreExcept: vi.fn(),
  initSocket: vi.fn(),
  io: undefined,
}));

beforeEach(() => {
  resetPrismaMock();
  resetFixtureIds();
});
