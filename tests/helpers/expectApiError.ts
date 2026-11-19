import { expect } from 'vitest';
import { ApiError } from '../../src/utils/ApiError';

interface Esperado {
  status: number;
  code: string;
  message?: string | RegExp;
}

/**
 * Afirma que la promesa rechaza con un ApiError con el status y code exactos
 * (el contrato que consume src/middleware/error.ts).
 */
export async function expectApiError(
  ejecutar: () => Promise<unknown>,
  esperado: Esperado
): Promise<void> {
  const promesa = ejecutar();
  await expect(promesa).rejects.toBeInstanceOf(ApiError);
  await expect(promesa).rejects.toMatchObject({
    status: esperado.status,
    code: esperado.code,
  });
  if (esperado.message !== undefined) {
    await expect(promesa).rejects.toMatchObject({ message: esperado.message });
  }
}
