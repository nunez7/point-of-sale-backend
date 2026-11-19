import { vi, type Mock } from 'vitest';

/**
 * Doble de pruebas de `src/config/prisma`.
 *
 * Es un Proxy: cualquier `prisma.<modelo>.<metodo>` que el servicio toque se
 * crea al vuelo como `vi.fn()`, sin mantener a mano la lista de los 32 modelos
 * del schema. Soporta además las operaciones que no son de modelo:
 *
 * - `$transaction(cb)`      → ejecuta el callback pasándole este mismo mock como `tx`
 * - `$transaction([...])`   → `Promise.all` del array
 * - `$queryRaw` / `$executeRaw` (también como tagged template)
 *
 * Uso típico en un test:
 *   prismaMock.category.findUnique.mockResolvedValue(null);
 *   await expect(deleteCategory('x', 'u1')).rejects.toMatchObject({ code: 'CATEGORIA_NOT_FOUND' });
 */

// El tipo se mantiene deliberadamente laxo: `Record<string, ModelMock>` da
// autocompletado por modelo y `& PrismaSpecialOps` hace que `$transaction` sea
// a la vez invocable y "espiable".
export type MockFn = Mock<(...args: any[]) => any>;
export type PrismaModelMock = Record<string, MockFn>;

interface PrismaSpecialOps {
  $transaction: MockFn;
  $queryRaw: MockFn;
  $queryRawUnsafe: MockFn;
  $executeRaw: MockFn;
  $executeRawUnsafe: MockFn;
  $connect: MockFn;
  $disconnect: MockFn;
}

export type PrismaMock = Record<string, PrismaModelMock> & PrismaSpecialOps;

type AnyFn = (...args: any[]) => any;

const methodCache = new Map<string, MockFn>();
const modelCache = new Map<string, PrismaModelMock>();

function fnFor(key: string): MockFn {
  const cached = methodCache.get(key);
  if (cached) return cached;
  const created = vi.fn<(...args: any[]) => any>();
  methodCache.set(key, created);
  return created;
}

function modelMock(name: string): PrismaModelMock {
  const cached = modelCache.get(name);
  if (cached) return cached;

  const created = new Proxy({} as PrismaModelMock, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return fnFor(`${name}.${prop}`);
    },
    has: () => true,
  });

  modelCache.set(name, created);
  return created;
}

// Implementaciones por defecto de las operaciones especiales. Se reaplican en
// cada reset; los tests que necesiten otro comportamiento usan mockImplementation.
function defaultTransaction(arg: unknown): unknown {
  if (typeof arg === 'function') return (arg as AnyFn)(prismaMock);
  if (Array.isArray(arg)) return Promise.all(arg);
  throw new Error('mock de $transaction: argumento no soportado');
}

function applyDefaults(): void {
  fnFor('$transaction').mockImplementation(async (arg: unknown) => defaultTransaction(arg));
  fnFor('$queryRaw').mockImplementation(async () => []);
  fnFor('$queryRawUnsafe').mockImplementation(async () => []);
  fnFor('$executeRaw').mockImplementation(async () => 0);
  fnFor('$executeRawUnsafe').mockImplementation(async () => 0);
  fnFor('$connect').mockImplementation(async () => undefined);
  fnFor('$disconnect').mockImplementation(async () => undefined);
}

export const prismaMock = new Proxy({} as PrismaMock, {
  get(_target, prop) {
    if (typeof prop !== 'string') return undefined;
    if (prop.startsWith('$')) return fnFor(prop);
    return modelMock(prop);
  },
  has: () => true,
}) as PrismaMock;

/** Deja el mock como recién creado: sin llamadas ni implementaciones previas. */
export function resetPrismaMock(): void {
  methodCache.clear();
  modelCache.clear();
  applyDefaults();
}

applyDefaults();
