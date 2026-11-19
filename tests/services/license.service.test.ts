import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prismaMock } from '../helpers/prismaMock';
import { emitToStore } from '../../src/socket/socket';
import { env } from '../../src/config/env';
import { ApiError } from '../../src/utils/ApiError';
import { LicenseStatus } from '../../generated/prisma/client.js';
import {
  activarCaja,
  activarLicencia,
  assertPuedeAbrirCaja,
  assertPuedeCrearCaja,
  calcularEstadoLicencia,
  estadoInstalacion,
  estadoLicencia,
  formatearCodigoInstalacion,
  liberarLicenciaCaja,
  listarEventosLicencia,
  leerTokenLicencia,
  modoLicencia,
  reservarLicenciaCaja,
  resumenLicenciasInstalacion,
  revisarLicencias,
  verificarToken,
} from '../../src/services/license.service';

// ---------------------------------------------------------------------------
// Llaves de prueba: el par se genera una vez por archivo. El servicio solo
// conoce la pública (como en producción); la privada se usa para firmar los
// tokens de prueba, igual que el emisor.
// ---------------------------------------------------------------------------

/** Afirma que la promesa rechaza con un ApiError del código indicado. */
async function expectApiError(promesa: Promise<unknown>, code: string): Promise<void> {
  await expect(promesa).rejects.toBeInstanceOf(ApiError);
  await expect(promesa).rejects.toMatchObject({ code });
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const LLAVE_PUBLICA = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const LLAVE_PRIVADA = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const INSTALACION_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const CODIGO_INSTALACION = formatearCodigoInstalacion(INSTALACION_ID);

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date('2026-06-15T18:00:00.000Z');

function instalacion(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALACION_ID,
    machineId: null,
    installedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSeenAt: null,
    licenseToken: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function licenciaFila(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    id: 'licencia-1',
    storeId: 'store-1',
    folio: 'SVCJ-2026-0001',
    plan: 'PRO',
    maxCajas: 2,
    issuedTo: 'Abarrotes La Esquina SA de CV',
    startsAt: new Date('2026-06-01T00:00:00.000Z'),
    expiresAt: new Date(AHORA.getTime() + 30 * DIA),
    graceDays: 15,
    status: LicenseStatus.ACTIVE,
    token: null,
    tokenHash: null,
    activatedAt: AHORA,
    activatedById: 'user-1',
    notes: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...overrides,
  };

  // El token se firma con los mismos datos de la fila para que los overrides
  // (fechas, cupo, plan) sigan siendo coherentes: el servicio lee el token.
  if (overrides.token === undefined) {
    base.token = firmar({
      v: 1,
      folio: base.folio,
      inst: CODIGO_INSTALACION,
      cliente: base.issuedTo,
      gracia: base.graceDays,
      iat: Math.floor((base.startsAt as Date).getTime() / 1000),
      exp: Math.floor((base.expiresAt as Date).getTime() / 1000),
      stores: [{ code: 'STORE001', plan: base.plan, maxCajas: base.maxCajas }],
    });
  }

  return base;
}

function firmar(payload: Record<string, unknown>, opciones: jwt.SignOptions = {}) {
  return jwt.sign(payload, LLAVE_PRIVADA, { algorithm: 'RS256', ...opciones });
}

function tokenValido(overrides: Record<string, unknown> = {}) {
  return firmar({
    v: 1,
    folio: 'SVCJ-2026-0001',
    inst: CODIGO_INSTALACION,
    cliente: 'Abarrotes La Esquina SA de CV',
    gracia: 15,
    iat: Math.floor(AHORA.getTime() / 1000) - 60,
    exp: Math.floor((AHORA.getTime() + 30 * DIA) / 1000),
    stores: [{ code: 'STORE001', plan: 'PRO', maxCajas: 2 }],
    ...overrides,
  });
}

// Deja los mocks mínimos que necesita cualquier lectura de estado.
function prepararEstado(overrides: {
  licencia?: Record<string, unknown> | null;
  cajas?: number;
  instalacion?: Record<string, unknown>;
} = {}) {
  prismaMock.installation.findFirst.mockResolvedValue(overrides.instalacion ?? instalacion());
  prismaMock.installation.update.mockResolvedValue(instalacion());
  prismaMock.store.findUnique.mockResolvedValue({ code: 'STORE001' });
  prismaMock.storeLicense.findUnique.mockResolvedValue(
    overrides.licencia === undefined ? licenciaFila() : overrides.licencia
  );
  prismaMock.cajaLicense.count.mockResolvedValue(overrides.cajas ?? 2);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  env.LICENCIA_PUBLIC_KEY = LLAVE_PUBLICA;
  env.LICENCIA_ENFORCEMENT = 'hard';
});

afterEach(() => {
  vi.useRealTimers();
  env.LICENCIA_PUBLIC_KEY = undefined;
  env.LICENCIA_ENFORCEMENT = 'off';
});

// ---------------------------------------------------------------------------
// Configuración y códigos de instalación
// ---------------------------------------------------------------------------

describe('modoLicencia', () => {
  it("es 'off' cuando no hay llave pública configurada", () => {
    env.LICENCIA_PUBLIC_KEY = undefined;
    env.LICENCIA_ENFORCEMENT = 'hard';
    expect(modoLicencia()).toBe('off');
  });

  it("es 'off' cuando la llave pública está vacía", () => {
    env.LICENCIA_PUBLIC_KEY = '   ';
    expect(modoLicencia()).toBe('off');
  });

  it('respeta el modo configurado cuando hay llave pública', () => {
    expect(modoLicencia()).toBe('hard');
    env.LICENCIA_ENFORCEMENT = 'soft';
    expect(modoLicencia()).toBe('soft');
  });
});

describe('formatearCodigoInstalacion', () => {
  it('agrupa los primeros 16 caracteres en bloques de 4', () => {
    expect(formatearCodigoInstalacion(INSTALACION_ID)).toBe('SVCJ-INST-A1B2-C3D4-E5F6-4A7B');
  });

  it('normaliza identificadores con caracteres no alfanuméricos', () => {
    expect(formatearCodigoInstalacion('ab-cd-ef')).toBe('SVCJ-INST-ABCD-EF');
  });
});

// ---------------------------------------------------------------------------
// Cálculo de estado
// ---------------------------------------------------------------------------

describe('calcularEstadoLicencia', () => {
  const expira = new Date(AHORA.getTime() - 10 * DIA);

  it('está activa mientras no pase la fecha de vencimiento', () => {
    expect(
      calcularEstadoLicencia(new Date(AHORA.getTime() + DIA), 15, AHORA, LicenseStatus.ACTIVE)
    ).toBe(LicenseStatus.ACTIVE);
  });

  it('entra en gracia dentro de los días configurados', () => {
    expect(calcularEstadoLicencia(expira, 15, AHORA, LicenseStatus.ACTIVE)).toBe(LicenseStatus.GRACE);
  });

  it('vence cuando se agota la gracia', () => {
    const vieja = new Date(AHORA.getTime() - 40 * DIA);
    expect(calcularEstadoLicencia(vieja, 15, AHORA, LicenseStatus.ACTIVE)).toBe(
      LicenseStatus.EXPIRED
    );
  });

  it('trata los días de gracia negativos como cero', () => {
    expect(calcularEstadoLicencia(expira, -5, AHORA, LicenseStatus.ACTIVE)).toBe(
      LicenseStatus.EXPIRED
    );
  });

  it('mantiene suspendida o revocada una licencia aunque la fecha esté vigente', () => {
    const futura = new Date(AHORA.getTime() + 30 * DIA);
    expect(calcularEstadoLicencia(futura, 15, AHORA, LicenseStatus.SUSPENDED)).toBe(
      LicenseStatus.SUSPENDED
    );
    expect(calcularEstadoLicencia(futura, 15, AHORA, LicenseStatus.REVOKED)).toBe(
      LicenseStatus.REVOKED
    );
  });
});

// ---------------------------------------------------------------------------
// estadoLicencia
// ---------------------------------------------------------------------------

describe('estadoLicencia', () => {
  it('no consulta la base cuando el licenciamiento está apagado', async () => {
    env.LICENCIA_PUBLIC_KEY = undefined;

    const estado = await estadoLicencia('store-1');

    expect(estado).toMatchObject({ aplica: false, modo: 'off', estado: 'SIN_LICENCIA' });
    expect(prismaMock.installation.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.storeLicense.findUnique).not.toHaveBeenCalled();
  });

  it('reporta el estado vigente con plan, cupo y días restantes', async () => {
    prepararEstado();

    const estado = await estadoLicencia('store-1');

    expect(estado).toMatchObject({
      aplica: true,
      modo: 'hard',
      estado: LicenseStatus.ACTIVE,
      vigente: true,
      enGracia: false,
      puedeAbrirCajas: true,
      diasRestantes: 30,
      plan: 'PRO',
      folio: 'SVCJ-2026-0001',
      maxCajas: 2,
      cajasLicenciadas: 2,
      mensaje: null,
      relojRetrocedido: false,
    });
    expect(estado.expiraEl).toBe(new Date(AHORA.getTime() + 30 * DIA).toISOString());
  });

  it('marca la gracia y explica hasta cuándo se puede operar', async () => {
    prepararEstado({ licencia: licenciaFila({ expiresAt: new Date(AHORA.getTime() - 5 * DIA) }) });

    const estado = await estadoLicencia('store-1');

    expect(estado).toMatchObject({ estado: LicenseStatus.GRACE, vigente: true, enGracia: true });
    expect(estado.mensaje).toContain('periodo de gracia');
  });

  it('bloquea la apertura de cajas cuando la licencia venció', async () => {
    prepararEstado({ licencia: licenciaFila({ expiresAt: new Date(AHORA.getTime() - 60 * DIA) }) });

    const estado = await estadoLicencia('store-1');

    expect(estado).toMatchObject({
      estado: LicenseStatus.EXPIRED,
      vigente: false,
      puedeAbrirCajas: false,
    });
    expect(estado.mensaje).toContain('Reactívala');
  });

  it('en modo aviso nunca impide abrir cajas', async () => {
    env.LICENCIA_ENFORCEMENT = 'soft';
    prepararEstado({ licencia: licenciaFila({ expiresAt: new Date(AHORA.getTime() - 60 * DIA) }) });

    const estado = await estadoLicencia('store-1');

    expect(estado).toMatchObject({ puedeAbrirCajas: true, estado: LicenseStatus.EXPIRED });
  });

  it('informa cuando la tienda no tiene licencia', async () => {
    prepararEstado({ licencia: null });

    const estado = await estadoLicencia('store-1');

    expect(estado).toMatchObject({ estado: 'SIN_LICENCIA', plan: null, maxCajas: 0 });
    expect(estado.mensaje).toContain('no tiene una licencia activada');
  });

  it('usa la última fecha vista cuando el reloj se atrasa (no extiende la licencia)', async () => {
    // La licencia venció hace 60 días, pero el reloj del servidor se atrasó 90.
    prepararEstado({
      instalacion: instalacion({ lastSeenAt: new Date(AHORA.getTime() + 90 * DIA) }),
      licencia: licenciaFila({ expiresAt: new Date(AHORA.getTime() - 60 * DIA) }),
    });

    const estado = await estadoLicencia('store-1');

    expect(estado.relojRetrocedido).toBe(true);
    expect(estado.estado).toBe(LicenseStatus.EXPIRED);
  });

  it('crea la instalación cuando todavía no existe', async () => {
    prismaMock.installation.findFirst.mockResolvedValue(null);
    prismaMock.installation.create.mockResolvedValue(instalacion());
    prismaMock.installation.update.mockResolvedValue(instalacion());
    prismaMock.storeLicense.findUnique.mockResolvedValue(licenciaFila());
    prismaMock.cajaLicense.count.mockResolvedValue(1);

    await estadoLicencia('store-1');

    expect(prismaMock.installation.create).toHaveBeenCalled();
  });

  it('sigue respondiendo si falla el guardado de la última fecha vista', async () => {
    prepararEstado();
    prismaMock.installation.update.mockRejectedValue(new Error('db caída'));

    await expect(estadoLicencia('store-1')).resolves.toMatchObject({
      estado: LicenseStatus.ACTIVE,
    });
  });
});

// ---------------------------------------------------------------------------
// El token firmado es la autoridad, no la fila de la base
// ---------------------------------------------------------------------------

describe('estadoLicencia con token firmado', () => {
  it('ignora una fecha extendida a mano en la base', async () => {
    // El cliente editó `store_license.expiresAt` a 10 años, pero el token que
    // firmó el creador venció hace 60 días: manda el token.
    const fila = licenciaFila({
      expiresAt: new Date(AHORA.getTime() + 3650 * DIA),
      token: firmar({
        v: 1,
        inst: CODIGO_INSTALACION,
        gracia: 0,
        iat: Math.floor((AHORA.getTime() - 120 * DIA) / 1000),
        exp: Math.floor((AHORA.getTime() - 60 * DIA) / 1000),
        stores: [{ code: 'STORE001', plan: 'PRO', maxCajas: 2 }],
      }),
    });
    prepararEstado({ licencia: fila });

    const estado = await estadoLicencia('store-1');

    expect(estado.estado).toBe(LicenseStatus.EXPIRED);
    expect(estado.puedeAbrirCajas).toBe(false);
  });

  it('toma el cupo de cajas del token, no de la fila', async () => {
    const fila = licenciaFila({
      maxCajas: 1,
      token: firmar({
        v: 1,
        inst: CODIGO_INSTALACION,
        gracia: 15,
        iat: Math.floor(AHORA.getTime() / 1000),
        exp: Math.floor((AHORA.getTime() + 20 * DIA) / 1000),
        stores: [{ code: 'STORE001', plan: 'MULTICAJA', maxCajas: 4 }],
      }),
    });
    prepararEstado({ licencia: fila, cajas: 1 });

    const estado = await estadoLicencia('store-1');

    expect(estado.maxCajas).toBe(4);
    expect(estado.plan).toBe('MULTICAJA');
  });

  it('queda sin licencia cuando el token guardado no verifica', async () => {
    prepararEstado({ licencia: licenciaFila({ token: 'no.es.un.token' }) });

    const estado = await estadoLicencia('store-1');

    expect(estado.estado).toBe('SIN_LICENCIA');
    expect(estado.mensaje).toContain('no es válido');
    expect(estado.vigente).toBe(false);
  });

  it('queda sin licencia cuando la fila no tiene token', async () => {
    prepararEstado({ licencia: licenciaFila({ token: null }) });

    await expect(estadoLicencia('store-1')).resolves.toMatchObject({
      estado: 'SIN_LICENCIA',
      vigente: false,
    });
  });

  it('rechaza un token emitido para otra instalación', async () => {
    prepararEstado({
      licencia: licenciaFila({
        token: tokenValido({ inst: 'SVCJ-INST-OTRA-INSTALACION' }),
      }),
    });

    await expect(estadoLicencia('store-1')).resolves.toMatchObject({
      estado: 'SIN_LICENCIA',
    });
  });
});

describe('leerTokenLicencia', () => {
  function tokenPara(code: string, expDias = 30) {
    return firmar({
      v: 1,
      folio: 'SVCJ-2026-0001',
      inst: CODIGO_INSTALACION,
      cliente: 'Abarrotes La Esquina SA de CV',
      gracia: 10,
      iat: Math.floor(AHORA.getTime() / 1000),
      exp: Math.floor((AHORA.getTime() + expDias * DIA) / 1000),
      stores: [{ code, plan: 'PRO', maxCajas: 3 }],
    });
  }

  it('devuelve los datos de la firma', () => {
    const datos = leerTokenLicencia(tokenPara('STORE001'), CODIGO_INSTALACION, 'store001');

    expect(datos).toMatchObject({
      graceDays: 10,
      maxCajas: 3,
      plan: 'PRO',
      folio: 'SVCJ-2026-0001',
      issuedTo: 'Abarrotes La Esquina SA de CV',
    });
    expect(datos?.expiresAt.toISOString()).toBe(new Date(AHORA.getTime() + 30 * DIA).toISOString());
  });

  it('devuelve null sin llave pública', () => {
    env.LICENCIA_PUBLIC_KEY = undefined;
    expect(leerTokenLicencia(tokenPara('STORE001'), CODIGO_INSTALACION, 'STORE001')).toBeNull();
  });

  it('devuelve null con firma inválida o token vacío', () => {
    expect(leerTokenLicencia('no.es.un.token', CODIGO_INSTALACION, 'STORE001')).toBeNull();
    expect(leerTokenLicencia('', CODIGO_INSTALACION, 'STORE001')).toBeNull();
    expect(leerTokenLicencia(null, CODIGO_INSTALACION, 'STORE001')).toBeNull();
  });

  it('devuelve null si el token es de otra instalación', () => {
    const token = tokenPara('STORE001');
    expect(leerTokenLicencia(token, 'SVCJ-INST-OTRA-INSTALACION', 'STORE001')).toBeNull();
  });

  it('devuelve null si el token no incluye la tienda', () => {
    expect(leerTokenLicencia(tokenPara('STORE002'), CODIGO_INSTALACION, 'STORE001')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// assertPuedeAbrirCaja
// ---------------------------------------------------------------------------

describe('assertPuedeAbrirCaja', () => {
  it('no hace nada con el licenciamiento apagado', async () => {
    env.LICENCIA_PUBLIC_KEY = undefined;
    await expect(assertPuedeAbrirCaja('store-1', 'caja-1')).resolves.toBeUndefined();
    expect(prismaMock.storeLicense.findUnique).not.toHaveBeenCalled();
  });

  it('rechaza cuando la tienda no tiene licencia activada', async () => {
    prepararEstado({ licencia: null });

    await expectApiError(assertPuedeAbrirCaja('store-1', 'caja-1'), 'LICENCIA_SIN_ACTIVAR');
  });

  it('rechaza cuando la licencia venció', async () => {
    prepararEstado({ licencia: licenciaFila({ expiresAt: new Date(AHORA.getTime() - 60 * DIA) }) });

    await expectApiError(assertPuedeAbrirCaja('store-1', 'caja-1'), 'LICENCIA_TIENDA_VENCIDA');
  });

  it('en modo aviso solo devuelve un aviso, sin lanzar', async () => {
    env.LICENCIA_ENFORCEMENT = 'soft';
    prepararEstado({ licencia: licenciaFila({ expiresAt: new Date(AHORA.getTime() - 60 * DIA) }) });

    await expect(assertPuedeAbrirCaja('store-1', 'caja-1')).resolves.toBeUndefined();
  });

  it('en gracia permite abrir sin revisar la licencia de la caja', async () => {
    prepararEstado({ licencia: licenciaFila({ expiresAt: new Date(AHORA.getTime() - 5 * DIA) }) });

    await expect(assertPuedeAbrirCaja('store-1', 'caja-1')).resolves.toBeUndefined();
    expect(prismaMock.cajaLicense.findUnique).not.toHaveBeenCalled();
  });

  it('rechaza una caja sin licencia operativa', async () => {
    prepararEstado();
    prismaMock.cajaLicense.findUnique.mockResolvedValue(null);

    await expectApiError(
      assertPuedeAbrirCaja('store-1', 'caja-1'),
      'CAJA_SIN_LICENCIA_OPERATIVA'
    );
  });

  it('rechaza una caja con licencia operativa suspendida', async () => {
    prepararEstado();
    prismaMock.cajaLicense.findUnique.mockResolvedValue({
      id: 'cl-1',
      storeId: 'store-1',
      storeLicenseId: 'licencia-1',
      cajaId: 'caja-1',
      expiresAt: new Date(AHORA.getTime() + 10 * DIA),
      status: LicenseStatus.SUSPENDED,
      activatedAt: AHORA,
      activatedById: null,
      createdAt: AHORA,
      updatedAt: AHORA,
    });

    await expectApiError(assertPuedeAbrirCaja('store-1', 'caja-1'), 'CAJA_LICENCIA_VENCIDA');
  });

  it('no confía en la fecha de vencimiento de la fila de la caja', async () => {
    // Un cliente podría editar `caja_license.expiresAt` con SQL: como la
    // vigencia la dicta el token de la tienda, la caja sigue operando.
    prepararEstado();
    prismaMock.cajaLicense.findUnique.mockResolvedValue({
      id: 'cl-1',
      storeId: 'store-1',
      storeLicenseId: 'licencia-1',
      cajaId: 'caja-1',
      expiresAt: new Date(AHORA.getTime() - 500 * DIA),
      status: LicenseStatus.ACTIVE,
      activatedAt: AHORA,
      activatedById: null,
      createdAt: AHORA,
      updatedAt: AHORA,
    });

    await expect(assertPuedeAbrirCaja('store-1', 'caja-1')).resolves.toBeUndefined();
  });

  it('permite abrir cuando la caja tiene licencia vigente', async () => {
    prepararEstado();
    prismaMock.cajaLicense.findUnique.mockResolvedValue({
      id: 'cl-1',
      storeId: 'store-1',
      storeLicenseId: 'licencia-1',
      cajaId: 'caja-1',
      expiresAt: new Date(AHORA.getTime() + 30 * DIA),
      status: LicenseStatus.ACTIVE,
      activatedAt: AHORA,
      activatedById: null,
      createdAt: AHORA,
      updatedAt: AHORA,
    });

    await expect(assertPuedeAbrirCaja('store-1', 'caja-1')).resolves.toBeUndefined();
  });

  it('en modo aviso no rechaza por falta de licencia de caja', async () => {
    env.LICENCIA_ENFORCEMENT = 'soft';
    prepararEstado();
    prismaMock.cajaLicense.findUnique.mockResolvedValue(null);

    await expect(assertPuedeAbrirCaja('store-1', 'caja-1')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// assertPuedeCrearCaja
// ---------------------------------------------------------------------------

describe('assertPuedeCrearCaja', () => {
  it('no hace nada con el licenciamiento apagado', async () => {
    env.LICENCIA_PUBLIC_KEY = undefined;
    await expect(assertPuedeCrearCaja('store-1')).resolves.toBeUndefined();
  });

  it('rechaza cuando se agotó el cupo de cajas', async () => {
    prepararEstado({ cajas: 2 });
    await expectApiError(assertPuedeCrearCaja('store-1'), 'LICENCIA_LIMITE_CAJAS');
  });

  it('permite crear mientras haya cupo', async () => {
    prepararEstado({ cajas: 1 });
    await expect(assertPuedeCrearCaja('store-1')).resolves.toBeUndefined();
  });

  it('rechaza cuando no hay licencia', async () => {
    prepararEstado({ licencia: null });
    await expectApiError(assertPuedeCrearCaja('store-1'), 'LICENCIA_SIN_ACTIVAR');
  });

  it('en modo aviso deja crear aunque no haya cupo', async () => {
    env.LICENCIA_ENFORCEMENT = 'soft';
    prepararEstado({ cajas: 5 });
    await expect(assertPuedeCrearCaja('store-1')).resolves.toBeUndefined();
  });

  it('en modo aviso deja crear aunque la licencia esté vencida', async () => {
    env.LICENCIA_ENFORCEMENT = 'soft';
    prepararEstado({ licencia: licenciaFila({ expiresAt: new Date(AHORA.getTime() - 60 * DIA) }) });
    await expect(assertPuedeCrearCaja('store-1')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reservarLicenciaCaja / liberarLicenciaCaja
// ---------------------------------------------------------------------------

describe('reservarLicenciaCaja', () => {
  it('devuelve false con el licenciamiento apagado', async () => {
    env.LICENCIA_PUBLIC_KEY = undefined;
    await expect(reservarLicenciaCaja('store-1', 'caja-1')).resolves.toBe(false);
    expect(prismaMock.cajaLicense.findUnique).not.toHaveBeenCalled();
  });

  it('es idempotente cuando la caja ya tiene licencia', async () => {
    prismaMock.cajaLicense.findUnique.mockResolvedValue({ id: 'cl-1' });

    await expect(reservarLicenciaCaja('store-1', 'caja-1')).resolves.toBe(true);
    expect(prismaMock.cajaLicense.create).not.toHaveBeenCalled();
  });

  it('no reserva si la tienda no tiene licencia', async () => {
    prismaMock.cajaLicense.findUnique.mockResolvedValue(null);
    prepararEstado({ licencia: null });

    await expect(reservarLicenciaCaja('store-1', 'caja-1')).resolves.toBe(false);
    expect(prismaMock.cajaLicense.create).not.toHaveBeenCalled();
  });

  it('no reserva si el cupo está lleno', async () => {
    prismaMock.cajaLicense.findUnique.mockResolvedValue(null);
    prepararEstado({ cajas: 2 });

    await expect(reservarLicenciaCaja('store-1', 'caja-1')).resolves.toBe(false);
    expect(prismaMock.cajaLicense.create).not.toHaveBeenCalled();
  });

  it('crea la licencia operativa cuando hay cupo', async () => {
    prismaMock.cajaLicense.findUnique.mockResolvedValue(null);
    prepararEstado({ cajas: 0 });

    await expect(reservarLicenciaCaja('store-1', 'caja-1', 'user-1')).resolves.toBe(true);

    const alta = prismaMock.cajaLicense.create.mock.calls[0]?.[0];
    expect(alta.data).toMatchObject({
      storeId: 'store-1',
      storeLicenseId: 'licencia-1',
      cajaId: 'caja-1',
      status: LicenseStatus.ACTIVE,
      activatedById: 'user-1',
    });
    expect(prismaMock.licenseEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: 'CAJA_LICENCIADA' }) })
    );
  });
});

describe('liberarLicenciaCaja', () => {
  it('no hace nada con el licenciamiento apagado', async () => {
    env.LICENCIA_PUBLIC_KEY = undefined;
    await liberarLicenciaCaja('caja-1');
    expect(prismaMock.cajaLicense.findUnique).not.toHaveBeenCalled();
  });

  it('no falla si la caja no tenía licencia', async () => {
    prismaMock.cajaLicense.findUnique.mockResolvedValue(null);
    await expect(liberarLicenciaCaja('caja-1')).resolves.toBeUndefined();
    expect(prismaMock.cajaLicense.delete).not.toHaveBeenCalled();
  });

  it('borra la licencia y registra el evento', async () => {
    prismaMock.cajaLicense.findUnique.mockResolvedValue({
      id: 'cl-1',
      storeId: 'store-1',
      storeLicenseId: 'licencia-1',
      cajaId: 'caja-1',
    });

    await liberarLicenciaCaja('caja-1');

    expect(prismaMock.cajaLicense.delete).toHaveBeenCalledWith({ where: { id: 'cl-1' } });
    expect(prismaMock.licenseEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: 'CAJA_LIBERADA' }) })
    );
  });
});

// ---------------------------------------------------------------------------
// activarCaja
// ---------------------------------------------------------------------------

describe('activarCaja', () => {
  it('rechaza una caja inexistente', async () => {
    prismaMock.caja.findFirst.mockResolvedValue(null);
    await expectApiError(activarCaja('caja-9', 'store-1'), 'CAJA_NOT_FOUND');
  });

  it('rechaza cuando el licenciamiento está apagado', async () => {
    env.LICENCIA_PUBLIC_KEY = undefined;
    prismaMock.caja.findFirst.mockResolvedValue({ id: 'caja-1' });
    await expectApiError(activarCaja('caja-1', 'store-1'), 'LICENCIA_NO_CONFIGURADA');
  });

  it('activa la caja cuando hay cupo', async () => {
    prismaMock.caja.findFirst.mockResolvedValue({ id: 'caja-1' });
    prismaMock.cajaLicense.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'cl-1', cajaId: 'caja-1' });
    prepararEstado({ cajas: 0 });

    await expect(activarCaja('caja-1', 'store-1', 'user-1')).resolves.toMatchObject({
      cajaId: 'caja-1',
    });
  });

  it('explica el límite cuando el cupo está lleno', async () => {
    prismaMock.caja.findFirst.mockResolvedValue({ id: 'caja-1' });
    prismaMock.cajaLicense.findUnique.mockResolvedValue(null);
    prepararEstado({ cajas: 2 });

    await expectApiError(activarCaja('caja-1', 'store-1'), 'LICENCIA_LIMITE_CAJAS');
  });

  it('explica el vencimiento cuando la licencia no está vigente', async () => {
    prismaMock.caja.findFirst.mockResolvedValue({ id: 'caja-1' });
    prismaMock.cajaLicense.findUnique.mockResolvedValue(null);
    prepararEstado({ licencia: licenciaFila({ expiresAt: new Date(AHORA.getTime() - 60 * DIA) }) });

    await expectApiError(activarCaja('caja-1', 'store-1'), 'LICENCIA_TIENDA_VENCIDA');
  });
});

// ---------------------------------------------------------------------------
// verificarToken
// ---------------------------------------------------------------------------

describe('verificarToken', () => {
  it('exige llave pública configurada', () => {
    env.LICENCIA_PUBLIC_KEY = undefined;
    expect(() => verificarToken('abc')).toThrow(
      expect.objectContaining({ code: 'LICENCIA_NO_CONFIGURADA' })
    );
  });

  it('rechaza un token con firma inválida', () => {
    expect(() => verificarToken('no.es.un.token')).toThrow(
      expect.objectContaining({ code: 'LICENCIA_TOKEN_INVALIDO' })
    );
  });

  it('rechaza un token expirado', () => {
    const token = firmar({ inst: CODIGO_INSTALACION, stores: [], exp: 1000 });
    expect(() => verificarToken(token)).toThrow(
      expect.objectContaining({ code: 'LICENCIA_TOKEN_VENCIDO' })
    );
  });

  it('rechaza un token sin las tiendas', () => {
    const token = firmar({
      inst: CODIGO_INSTALACION,
      exp: Math.floor((AHORA.getTime() + DIA) / 1000),
      stores: [],
    });
    expect(() => verificarToken(token)).toThrow(
      expect.objectContaining({ code: 'LICENCIA_TOKEN_INVALIDO' })
    );
  });

  it('rechaza un token sin el código de instalación', () => {
    const token = firmar({
      exp: Math.floor((AHORA.getTime() + DIA) / 1000),
      stores: [{ code: 'STORE001' }],
    });
    expect(() => verificarToken(token)).toThrow(
      expect.objectContaining({ code: 'LICENCIA_TOKEN_INVALIDO' })
    );
  });

  it('devuelve el contenido de un token válido', () => {
    const contenido = verificarToken(tokenValido());
    expect(contenido.inst).toBe(CODIGO_INSTALACION);
    expect(contenido.stores).toEqual([{ code: 'STORE001', plan: 'PRO', maxCajas: 2 }]);
  });
});

// ---------------------------------------------------------------------------
// activarLicencia
// ---------------------------------------------------------------------------

describe('activarLicencia', () => {
  function prepararActivacion(overrides: { tienda?: unknown; licencia?: unknown } = {}) {
    prismaMock.installation.findFirst.mockResolvedValue(instalacion());
    prismaMock.installation.update.mockResolvedValue(instalacion());
    prismaMock.store.findUnique.mockResolvedValue(
      overrides.tienda === undefined
        ? { id: 'store-1', code: 'STORE001', name: 'Sucursal Centro' }
        : overrides.tienda
    );
    prismaMock.storeLicense.upsert.mockResolvedValue(
      overrides.licencia ?? licenciaFila({ id: 'licencia-1', maxCajas: 2 })
    );
    prismaMock.cajaLicense.findMany.mockResolvedValue([
      { id: 'cl-1', storeId: 'store-1', storeLicenseId: 'licencia-vieja', activatedAt: AHORA },
    ]);
    prismaMock.caja.findMany.mockResolvedValue([{ id: 'caja-2', createdAt: AHORA }]);
    prismaMock.cajaLicense.count.mockResolvedValue(2);
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.licenseEvent.create.mockResolvedValue({});
  }

  it('rechaza un código emitido para otra instalación', async () => {
    prepararActivacion();
    const token = tokenValido({ inst: 'SVCJ-INST-OTRA-INSTALACION' });

    await expectApiError(activarLicencia(token, 'user-1'), 'LICENCIA_OTRA_INSTALACION');
  });

  it('rechaza un código que ya venció (tolerancia de reloj)', async () => {
    prepararActivacion();
    // Dentro de la tolerancia de 60 s, la firma se valida y luego se rechaza.
    const token = tokenValido({ exp: Math.floor(AHORA.getTime() / 1000) - 30 });

    await expectApiError(activarLicencia(token, 'user-1'), 'LICENCIA_TOKEN_VENCIDO');
  });

  it('activa la licencia, renueva cajas y registra auditoría', async () => {
    prepararActivacion();

    const resultado = await activarLicencia(tokenValido(), 'user-1');

    expect(resultado).toMatchObject({
      folio: 'SVCJ-2026-0001',
      instalacion: CODIGO_INSTALACION,
      graceDays: 15,
      advertencias: [],
    });
    expect(resultado.tiendas).toEqual([
      {
        storeId: 'store-1',
        code: 'STORE001',
        name: 'Sucursal Centro',
        plan: 'PRO',
        maxCajas: 2,
        cajasLicenciadas: 2,
      },
    ]);

    const upsert = prismaMock.storeLicense.upsert.mock.calls[0]?.[0];
    expect(upsert.where).toEqual({ storeId: 'store-1' });
    expect(upsert.create).toMatchObject({ plan: 'PRO', maxCajas: 2, status: LicenseStatus.ACTIVE });
    expect(prismaMock.cajaLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cl-1' } })
    );
    expect(prismaMock.cajaLicense.create).toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
    expect(prismaMock.installation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ licenseToken: expect.any(String) }) })
    );
    expect(vi.mocked(emitToStore)).toHaveBeenCalledWith(
      'store-1',
      'license:updated',
      expect.objectContaining({ storeId: 'store-1' })
    );
  });

  it('avisa cuando la tienda del código no existe en la instalación', async () => {
    prepararActivacion({ tienda: null });

    await expectApiError(activarLicencia(tokenValido(), 'user-1'), 'LICENCIA_SIN_TIENDAS');
    expect(prismaMock.storeLicense.upsert).not.toHaveBeenCalled();
  });

  it('ignora tiendas sin identificador', async () => {
    prepararActivacion();

    await expectApiError(
      activarLicencia(tokenValido({ stores: [{ code: '  ' }] }), 'user-1'),
      'LICENCIA_SIN_TIENDAS'
    );
  });

  it('quita las licencias operativas que sobran respecto al cupo', async () => {
    prepararActivacion({
      licencia: licenciaFila({ id: 'licencia-1', maxCajas: 1 }),
    });
    prismaMock.cajaLicense.findMany.mockResolvedValue([
      { id: 'cl-1', storeId: 'store-1', storeLicenseId: 'licencia-vieja', activatedAt: AHORA },
      { id: 'cl-2', storeId: 'store-1', storeLicenseId: 'licencia-vieja', activatedAt: AHORA },
    ]);

    await activarLicencia(tokenValido({ stores: [{ code: 'STORE001', plan: 'BASICO', maxCajas: 1 }] }), 'user-1');

    expect(prismaMock.cajaLicense.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['cl-2'] } },
    });
    expect(prismaMock.caja.findMany).not.toHaveBeenCalled();
  });

  it('usa la gracia por defecto cuando el token no la trae', async () => {
    prepararActivacion();
    const token = tokenValido({ gracia: undefined });

    const resultado = await activarLicencia(token, 'user-1');

    expect(resultado.graceDays).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Eventos, instalación y resumen
// ---------------------------------------------------------------------------

describe('listarEventosLicencia', () => {
  it('devuelve el historial de la tienda', async () => {
    prismaMock.licenseEvent.findMany.mockResolvedValue([
      {
        id: 'ev-1',
        tipo: 'ACTIVACION',
        mensaje: 'Licencia activada',
        metadata: { plan: 'PRO' },
        createdAt: AHORA,
        userId: 'user-1',
      },
    ]);

    const eventos = await listarEventosLicencia('store-1');

    expect(prismaMock.licenseEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 'store-1' }, take: 50 })
    );
    expect(eventos).toHaveLength(1);
  });

  it('tolera una respuesta vacía', async () => {
    prismaMock.licenseEvent.findMany.mockResolvedValue(undefined);
    await expect(listarEventosLicencia('store-1')).resolves.toEqual([]);
  });
});

describe('estadoInstalacion', () => {
  it('expone el código de instalación y el modo activo', async () => {
    prismaMock.installation.findFirst.mockResolvedValue(instalacion());

    const estado = await estadoInstalacion();

    expect(estado).toMatchObject({
      id: INSTALACION_ID,
      codigo: CODIGO_INSTALACION,
      aplica: true,
      modo: 'hard',
    });
  });
});

describe('resumenLicenciasInstalacion', () => {
  it('resume todas las tiendas con y sin licencia', async () => {
    prismaMock.installation.findFirst.mockResolvedValue(instalacion());
    prismaMock.installation.update.mockResolvedValue(instalacion());
    prismaMock.store.findMany.mockResolvedValue([
      { id: 'store-1', name: 'Centro', code: 'STORE001', isActive: true },
      { id: 'store-2', name: 'Norte', code: 'STORE002', isActive: true },
    ]);
    prismaMock.storeLicense.findMany.mockResolvedValue([
      licenciaFila({ id: 'licencia-1', storeId: 'store-1' }),
    ]);
    prismaMock.cajaLicense.groupBy.mockResolvedValue([
      { storeId: 'store-1', _count: { _all: 2 } },
    ]);

    const resumen = await resumenLicenciasInstalacion();

    expect(resumen.instalacion).toBe(CODIGO_INSTALACION);
    expect(resumen.tiendas).toEqual([
      expect.objectContaining({
        storeId: 'store-1',
        estado: LicenseStatus.ACTIVE,
        cajasLicenciadas: 2,
        maxCajas: 2,
      }),
      expect.objectContaining({
        storeId: 'store-2',
        estado: 'SIN_LICENCIA',
        plan: null,
        maxCajas: 0,
      }),
    ]);
  });

  it('no toca la instalación cuando el licenciamiento está apagado', async () => {
    env.LICENCIA_PUBLIC_KEY = undefined;
    prismaMock.installation.findFirst.mockResolvedValue(instalacion());
    prismaMock.store.findMany.mockResolvedValue([]);
    prismaMock.storeLicense.findMany.mockResolvedValue([]);
    prismaMock.cajaLicense.groupBy.mockResolvedValue([]);

    const resumen = await resumenLicenciasInstalacion();

    expect(resumen.modo).toBe('off');
    expect(resumen.tiendas).toEqual([]);
    expect(prismaMock.installation.update).not.toHaveBeenCalled();
  });
});

describe('revisarLicencias', () => {
  it('no hace nada con el licenciamiento apagado', async () => {
    env.LICENCIA_PUBLIC_KEY = undefined;
    await expect(revisarLicencias()).resolves.toEqual({ avisadas: 0, vencidas: 0 });
    expect(prismaMock.storeLicense.findMany).not.toHaveBeenCalled();
  });

  it('avisa por socket las licencias próximas a vencer', async () => {
    prismaMock.installation.findFirst.mockResolvedValue(instalacion());
    prismaMock.installation.update.mockResolvedValue(instalacion());
    prismaMock.store.findMany.mockResolvedValue([{ id: 'store-1', code: 'STORE001' }]);
    prismaMock.storeLicense.findMany.mockResolvedValue([
      licenciaFila({ expiresAt: new Date(AHORA.getTime() + 7 * DIA) }),
    ]);

    const resultado = await revisarLicencias();

    expect(resultado).toEqual({ avisadas: 1, vencidas: 0 });
    expect(vi.mocked(emitToStore)).toHaveBeenCalledWith(
      'store-1',
      'license:expiring',
      expect.objectContaining({ diasRestantes: 7 })
    );
  });

  it('guarda la transición a vencida', async () => {
    prismaMock.installation.findFirst.mockResolvedValue(instalacion());
    prismaMock.installation.update.mockResolvedValue(instalacion());
    prismaMock.store.findMany.mockResolvedValue([{ id: 'store-1', code: 'STORE001' }]);
    prismaMock.storeLicense.findMany.mockResolvedValue([
      licenciaFila({ expiresAt: new Date(AHORA.getTime() - 60 * DIA) }),
    ]);
    prismaMock.storeLicense.update.mockResolvedValue(licenciaFila());
    prismaMock.licenseEvent.create.mockResolvedValue({});

    const resultado = await revisarLicencias();

    expect(resultado).toEqual({ avisadas: 0, vencidas: 1 });
    expect(prismaMock.storeLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: LicenseStatus.EXPIRED } })
    );
    expect(prismaMock.licenseEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: 'CAMBIO_ESTADO' }) })
    );
  });

  it('no reescribe el estado cuando no cambió', async () => {
    prismaMock.installation.findFirst.mockResolvedValue(instalacion());
    prismaMock.installation.update.mockResolvedValue(instalacion());
    prismaMock.store.findMany.mockResolvedValue([{ id: 'store-1', code: 'STORE001' }]);
    prismaMock.storeLicense.findMany.mockResolvedValue([licenciaFila()]);

    await revisarLicencias();

    expect(prismaMock.storeLicense.update).not.toHaveBeenCalled();
  });
});
