import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { emitToStore } from '../socket/socket';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';
import { sha256 } from '../utils/tokenHash';
import { LicenseStatus, Prisma } from '../../generated/prisma/client.js';

// =============================================================================
// Licenciamiento on-premise
// =============================================================================
// El cliente es dueño de la base de datos, así que la autoridad NO es ninguna
// fecha editable aquí: es el token firmado que el creador genera con su llave
// privada (tools/emisor-licencias). El backend solo tiene la llave pública y
// verifica la firma. La DB guarda una copia del token para auditoría y para
// poder recalcular el estado sin volver a pedirlo.
//
// Regla anti-retroceso de reloj: la fecha con la que se evalúa la licencia es
// el máximo entre "ahora" y la última fecha vista por la instalación. Atrasar
// el reloj del servidor no alarga la licencia.

const DIA_MS = 24 * 60 * 60 * 1000;
const TOLERANCIA_RELOJ_MS = 6 * 60 * 60 * 1000;
const DIAS_GRACIA_POR_DEFECTO = 15;
// Días antes del vencimiento en los que el frontend recibe el aviso por socket.
const DIAS_DE_AVISO = [15, 7, 3, 1];

export type ModoLicencia = 'off' | 'soft' | 'hard';

export type EstadoLicenciaCodigo =
  | 'SIN_LICENCIA'
  | 'ACTIVE'
  | 'GRACE'
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'REVOKED';

export interface EstadoLicencia {
  // `false` cuando no hay llave pública configurada: la verificación no aplica.
  aplica: boolean;
  modo: ModoLicencia;
  estado: EstadoLicenciaCodigo;
  // Puede operar (ACTIVE o GRACE).
  vigente: boolean;
  enGracia: boolean;
  // Si `false`, la UI debe impedir abrir turnos nuevos.
  puedeAbrirCajas: boolean;
  diasRestantes: number | null;
  expiraEl: string | null;
  graciaHasta: string | null;
  plan: string | null;
  folio: string | null;
  issuedTo: string | null;
  maxCajas: number;
  cajasLicenciadas: number;
  mensaje: string | null;
  relojRetrocedido: boolean;
}

export interface ContenidoToken {
  v?: number;
  folio?: string;
  inst: string;
  cliente?: string;
  gracia?: number;
  iat?: number;
  exp: number;
  stores: { code: string; plan?: string; maxCajas?: number }[];
}

interface LicenciaRow {
  id: string;
  storeId: string;
  plan: string;
  maxCajas: number;
  issuedTo: string | null;
  folio: string | null;
  expiresAt: Date;
  graceDays: number;
  status: LicenseStatus;
}

// -----------------------------------------------------------------------------
// Configuración
// -----------------------------------------------------------------------------

/**
 * Modo efectivo de enforcement. Sin llave pública no se puede verificar nada.
 *
 * `LICENCIA_PUBLIC_KEY` admite el PEM tal cual (con saltos de línea) o su
 * representación base64 en una sola línea, que es lo cómodo para un `.env`.
 */
export function llavePublica(): string | undefined {
  const crudo = env.LICENCIA_PUBLIC_KEY?.trim();
  if (!crudo) return undefined;

  // PEM pegado directamente (los saltos de línea pueden venir escapados).
  if (crudo.includes('BEGIN PUBLIC KEY')) {
    return crudo.replace(/\\n/g, '\n');
  }

  // Base64 de una línea.
  try {
    const decodificada = Buffer.from(crudo, 'base64').toString('utf8');
    if (decodificada.includes('BEGIN PUBLIC KEY')) return decodificada;
  } catch {
    /* valor no utilizable */
  }

  return undefined;
}

export function modoLicencia(): ModoLicencia {
  if (!llavePublica()) return 'off';
  return env.LICENCIA_ENFORCEMENT;
}

/** `true` solo en modo estricto: es el único que bloquea operaciones. */
export function licenciaBloquea(): boolean {
  return modoLicencia() === 'hard';
}

// -----------------------------------------------------------------------------
// Instalación
// -----------------------------------------------------------------------------

export function formatearCodigoInstalacion(installationId: string): string {
  const limpio = installationId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16);
  const grupos = limpio.match(/.{1,4}/g) ?? [limpio];
  return `SVCJ-INST-${grupos.join('-')}`;
}

function normalizarCodigoInstalacion(codigo: string): string {
  return codigo
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^SVCJINST/, '');
}

/** Instalación física del sistema (una sola fila por servidor). */
export async function obtenerInstalacion() {
  const existente = await prisma.installation.findFirst({
    orderBy: { installedAt: 'asc' },
  });
  if (existente) return existente;
  return prisma.installation.create({ data: {} });
}

interface ContextoTiempo {
  ahora: Date;
  efectiva: Date;
  relojRetrocedido: boolean;
}

/**
 * Fecha efectiva del servidor: nunca retrocede. Si detecta que el reloj se
 * atrasó respecto a la última visita (más de la tolerancia), lo reporta para
 * que la UI avise, pero no bloquea por sí mismo: la licencia se evalúa con la
 * fecha mayor.
 */
async function contextoDeTiempo(instalacion: {
  id: string;
  lastSeenAt: Date | null;
}): Promise<ContextoTiempo> {
  const ahora = new Date();
  const previo = instalacion.lastSeenAt;
  const relojRetrocedido =
    !!previo && ahora.getTime() < previo.getTime() - TOLERANCIA_RELOJ_MS;
  const efectiva = previo && previo.getTime() > ahora.getTime() ? previo : ahora;

  try {
    await prisma.installation.update({
      where: { id: instalacion.id },
      data: { lastSeenAt: efectiva },
    });
  } catch (err) {
    // Que falle la marca de tiempo no debe tumbar la operación del POS.
    logger.warn('No se pudo actualizar lastSeenAt de la instalación', { err });
  }

  return { ahora, efectiva, relojRetrocedido };
}

// -----------------------------------------------------------------------------
// Cálculo de estado (funciones puras: fáciles de probar)
// -----------------------------------------------------------------------------

export function calcularEstadoLicencia(
  expiresAt: Date,
  graceDays: number,
  ahora: Date,
  estadoGuardado: LicenseStatus
): LicenseStatus {
  // Suspender/revocar es una decisión manual del creador y manda sobre las fechas.
  if (
    estadoGuardado === LicenseStatus.SUSPENDED ||
    estadoGuardado === LicenseStatus.REVOKED
  ) {
    return estadoGuardado;
  }
  if (ahora.getTime() <= expiresAt.getTime()) return LicenseStatus.ACTIVE;
  const finGracia = expiresAt.getTime() + Math.max(0, graceDays) * DIA_MS;
  return ahora.getTime() <= finGracia ? LicenseStatus.GRACE : LicenseStatus.EXPIRED;
}

function diasHasta(fecha: Date, ahora: Date): number {
  return Math.ceil((fecha.getTime() - ahora.getTime()) / DIA_MS);
}

function aIso(fecha: Date): string {
  return fecha.toISOString();
}

function estadoVacio(modo: ModoLicencia, aplica: boolean): EstadoLicencia {
  return {
    aplica,
    modo,
    estado: 'SIN_LICENCIA',
    vigente: false,
    enGracia: false,
    puedeAbrirCajas: modo !== 'hard',
    diasRestantes: null,
    expiraEl: null,
    graciaHasta: null,
    plan: null,
    folio: null,
    issuedTo: null,
    maxCajas: 0,
    cajasLicenciadas: 0,
    mensaje: null,
    relojRetrocedido: false,
  };
}

function mensajeDeEstado(
  estado: LicenseStatus,
  expiresAt: Date,
  graceDays: number
): string | null {
  const vence = expiresAt.toISOString().slice(0, 10);
  switch (estado) {
    case LicenseStatus.GRACE: {
      const fin = new Date(expiresAt.getTime() + Math.max(0, graceDays) * DIA_MS);
      return `La licencia venció el ${vence}. Estás en el periodo de gracia hasta el ${fin
        .toISOString()
        .slice(0, 10)}.`;
    }
    case LicenseStatus.EXPIRED:
      return `La licencia venció el ${vence} y el periodo de gracia terminó. Reactívala para seguir abriendo cajas.`;
    case LicenseStatus.SUSPENDED:
      return 'La licencia está suspendida. Contacta a tu proveedor para reactivarla.';
    case LicenseStatus.REVOKED:
      return 'La licencia fue revocada. Contacta a tu proveedor para reactivarla.';
    default:
      return null;
  }
}

/** Evalúa una fila de licencia contra la fecha efectiva ya calculada. */
function evaluarFila(
  licencia: LicenciaRow,
  cajasLicenciadas: number,
  efectiva: Date,
  relojRetrocedido: boolean,
  modo: ModoLicencia
): EstadoLicencia {
  const estado = calcularEstadoLicencia(
    licencia.expiresAt,
    licencia.graceDays,
    efectiva,
    licencia.status
  );
  const vigente = estado === LicenseStatus.ACTIVE || estado === LicenseStatus.GRACE;

  return {
    aplica: modo !== 'off',
    modo,
    estado,
    vigente,
    enGracia: estado === LicenseStatus.GRACE,
    puedeAbrirCajas: modo === 'hard' ? vigente : true,
    diasRestantes: diasHasta(licencia.expiresAt, efectiva),
    expiraEl: aIso(licencia.expiresAt),
    graciaHasta: aIso(
      new Date(licencia.expiresAt.getTime() + Math.max(0, licencia.graceDays) * DIA_MS)
    ),
    plan: licencia.plan,
    folio: licencia.folio,
    issuedTo: licencia.issuedTo,
    maxCajas: licencia.maxCajas,
    cajasLicenciadas,
    mensaje: mensajeDeEstado(estado, licencia.expiresAt, licencia.graceDays),
    relojRetrocedido,
  };
}

interface EvaluacionTienda {
  estado: EstadoLicencia;
  efectiva: Date;
  licencia: LicenciaRow | null;
}

/** Estado + fecha efectiva + fila cruda. Uso interno. */
async function evaluarTienda(storeId: string): Promise<EvaluacionTienda> {
  const modo = modoLicencia();
  if (modo === 'off') {
    return { estado: estadoVacio(modo, false), efectiva: new Date(), licencia: null };
  }

  const instalacion = await obtenerInstalacion();
  const { efectiva, relojRetrocedido } = await contextoDeTiempo(instalacion);

  const licencia = await prisma.storeLicense.findUnique({ where: { storeId } });
  if (!licencia) {
    return {
      estado: {
        ...estadoVacio(modo, true),
        relojRetrocedido,
        mensaje:
          modo === 'hard'
            ? 'Esta instalación no tiene una licencia activada. Actívala para poder abrir cajas.'
            : 'Esta instalación no tiene una licencia activada.',
      },
      efectiva,
      licencia: null,
    };
  }

  // La fecha y el cupo salen del token firmado, no de la fila (que el cliente
  // puede editar con SQL). Sin token válido la licencia no cuenta.
  const codigoLocal = formatearCodigoInstalacion(instalacion.id);
  const tienda = await prisma.store.findUnique({
    where: { id: storeId },
    select: { code: true },
  });
  const delToken = tienda
    ? leerTokenLicencia(licencia.token, codigoLocal, tienda.code)
    : null;

  if (!delToken) {
    return {
      estado: {
        ...estadoVacio(modo, true),
        relojRetrocedido,
        mensaje:
          modo === 'hard'
            ? 'El código de licencia de esta instalación no es válido o fue alterado. Actívala de nuevo con el código que te envió el proveedor.'
            : 'El código de licencia de esta instalación no es válido o fue alterado.',
      },
      efectiva,
      licencia: null,
    };
  }

  const vigentePorToken: LicenciaRow = {
    ...licencia,
    plan: delToken.plan,
    maxCajas: delToken.maxCajas,
    folio: delToken.folio,
    issuedTo: delToken.issuedTo,
    expiresAt: delToken.expiresAt,
    graceDays: delToken.graceDays,
  };

  const cajasLicenciadas = await prisma.cajaLicense.count({ where: { storeId } });
  return {
    estado: evaluarFila(vigentePorToken, cajasLicenciadas, efectiva, relojRetrocedido, modo),
    efectiva,
    licencia: vigentePorToken,
  };
}

/** Estado público de la licencia de una tienda. */
export async function estadoLicencia(storeId: string): Promise<EstadoLicencia> {
  const { estado } = await evaluarTienda(storeId);
  return estado;
}

// -----------------------------------------------------------------------------
// Enforcement
// -----------------------------------------------------------------------------

/** Se llama antes de abrir un turno de caja. */
export async function assertPuedeAbrirCaja(storeId: string, cajaId: string): Promise<void> {
  const modo = modoLicencia();
  if (modo === 'off') return;

  const { estado } = await evaluarTienda(storeId);

  if (!estado.vigente) {
    if (modo === 'hard') {
      throw ApiError.forbidden(
        estado.mensaje ?? 'La licencia de la tienda no está vigente',
        estado.estado === 'SIN_LICENCIA'
          ? 'LICENCIA_SIN_ACTIVAR'
          : 'LICENCIA_TIENDA_VENCIDA'
      );
    }
    return;
  }

  // En periodo de gracia se permite operar con todo: no se valida la caja.
  if (estado.enGracia) return;

  const cajaLicencia = await prisma.cajaLicense.findUnique({ where: { cajaId } });
  if (!cajaLicencia) {
    if (modo === 'hard') {
      throw ApiError.forbidden(
        'Esta caja no tiene licencia operativa activada. Contacta a tu proveedor para activarla.',
        'CAJA_SIN_LICENCIA_OPERATIVA'
      );
    }
    return;
  }

  // La vigencia de la caja la dicta el token de la tienda (la fecha de la fila
  // es editable con SQL); aquí solo se respeta una suspensión manual.
  if (
    cajaLicencia.status === LicenseStatus.SUSPENDED ||
    cajaLicencia.status === LicenseStatus.REVOKED
  ) {
    if (modo === 'hard') {
      throw ApiError.forbidden(
        'La licencia operativa de esta caja está suspendida. Contacta a tu proveedor.',
        'CAJA_LICENCIA_VENCIDA'
      );
    }
  }
}

/** Se llama antes de crear una caja nueva (valida que quede cupo). */
export async function assertPuedeCrearCaja(storeId: string): Promise<void> {
  const modo = modoLicencia();
  if (modo === 'off') return;

  const { estado } = await evaluarTienda(storeId);
  if (!estado.vigente) {
    if (modo === 'hard') {
      throw ApiError.forbidden(
        estado.mensaje ?? 'La licencia de la tienda no está vigente',
        estado.estado === 'SIN_LICENCIA' ? 'LICENCIA_SIN_ACTIVAR' : 'LICENCIA_TIENDA_VENCIDA'
      );
    }
    return;
  }
  if (estado.cajasLicenciadas >= estado.maxCajas && modo === 'hard') {
    throw ApiError.forbidden(
      `La licencia permite ${estado.maxCajas} caja(s). Desactiva una caja o amplía la licencia para agregar otra.`,
      'LICENCIA_LIMITE_CAJAS'
    );
  }
}

/**
 * Asigna una licencia operativa a una caja si la tienda tiene licencia vigente
 * y cupo disponible. Idempotente: si la caja ya la tiene, no hace nada.
 * Devuelve `true` si la caja quedó licenciada.
 */
export async function reservarLicenciaCaja(
  storeId: string,
  cajaId: string,
  userId?: string | null
): Promise<boolean> {
  const modo = modoLicencia();
  if (modo === 'off') return false;

  const existente = await prisma.cajaLicense.findUnique({ where: { cajaId } });
  if (existente) return true;

  const { estado, efectiva, licencia } = await evaluarTienda(storeId);
  if (!licencia || !estado.vigente) return false;
  if (estado.cajasLicenciadas >= licencia.maxCajas) return false;

  await prisma.cajaLicense.create({
    data: {
      storeId,
      storeLicenseId: licencia.id,
      cajaId,
      expiresAt: licencia.expiresAt,
      status: LicenseStatus.ACTIVE,
      activatedById: userId ?? null,
    },
  });

  await registrarEvento('CAJA_LICENCIADA', {
    storeId,
    storeLicenseId: licencia.id,
    userId: userId ?? null,
    mensaje: `Se asignó licencia operativa a la caja ${cajaId}.`,
    metadata: { cajaId, efectiva: efectiva.toISOString() },
  });

  return true;
}

/** Libera el cupo cuando una caja se desactiva o se elimina. */
export async function liberarLicenciaCaja(cajaId: string): Promise<void> {
  if (modoLicencia() === 'off') return;
  const existente = await prisma.cajaLicense.findUnique({ where: { cajaId } });
  if (!existente) return;
  await prisma.cajaLicense.delete({ where: { id: existente.id } });
  await registrarEvento('CAJA_LIBERADA', {
    storeId: existente.storeId,
    storeLicenseId: existente.storeLicenseId,
    mensaje: 'Se liberó la licencia operativa de una caja.',
    metadata: { cajaId },
  });
}

/** Asigna explícitamente una licencia operativa (menú Cajas / Licencias). */
export async function activarCaja(cajaId: string, storeId: string, userId?: string | null) {
  const caja = await prisma.caja.findFirst({ where: { id: cajaId, storeId } });
  if (!caja) throw ApiError.notFound('Caja no encontrada', 'CAJA_NOT_FOUND');

  if (modoLicencia() === 'off') {
    throw ApiError.badRequest(
      'La verificación de licencias está desactivada en esta instalación',
      'LICENCIA_NO_CONFIGURADA'
    );
  }

  const ok = await reservarLicenciaCaja(storeId, cajaId, userId);
  if (!ok) {
    const estado = await estadoLicencia(storeId);
    if (!estado.vigente) {
      throw ApiError.forbidden(
        estado.mensaje ?? 'La licencia de la tienda no está vigente',
        'LICENCIA_TIENDA_VENCIDA'
      );
    }
    throw ApiError.forbidden(
      `La licencia permite ${estado.maxCajas} caja(s) y ya están ocupadas. Libera una caja o amplía la licencia.`,
      'LICENCIA_LIMITE_CAJAS'
    );
  }

  return prisma.cajaLicense.findUnique({ where: { cajaId } });
}

// -----------------------------------------------------------------------------
// Activación del token firmado
// -----------------------------------------------------------------------------

export function verificarToken(token: string): ContenidoToken {
  const publicKey = llavePublica();
  if (!publicKey) {
    throw ApiError.badRequest(
      'Esta instalación no tiene configurada la verificación de licencias (falta LICENCIA_PUBLIC_KEY).',
      'LICENCIA_NO_CONFIGURADA'
    );
  }

  let payload: ContenidoToken;
  try {
    payload = jwt.verify(token.trim(), publicKey, {
      algorithms: ['RS256'],
      clockTolerance: 60,
    }) as ContenidoToken;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw ApiError.badRequest(
        'El código de licencia ya venció. Solicita uno nuevo.',
        'LICENCIA_TOKEN_VENCIDO'
      );
    }
    throw ApiError.badRequest(
      'El código de licencia no es válido o fue alterado.',
      'LICENCIA_TOKEN_INVALIDO'
    );
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.inst !== 'string' ||
    !Array.isArray(payload.stores) ||
    payload.stores.length === 0 ||
    typeof payload.exp !== 'number'
  ) {
    throw ApiError.badRequest(
      'El código de licencia no tiene el contenido esperado.',
      'LICENCIA_TOKEN_INVALIDO'
    );
  }

  return payload;
}

export interface LicenciaDelToken {
  expiresAt: Date;
  graceDays: number;
  maxCajas: number;
  plan: string;
  folio: string | null;
  issuedTo: string | null;
}

/**
 * Verifica el token guardado y devuelve los datos que MANDA la firma, no los de
 * la fila de la base.
 *
 * Es la pieza clave del modelo on-premise: el cliente es dueño de PostgreSQL y
 * podría editar `store_license.expiresAt` a mano; si se confiara en esa fecha,
 * la licencia se renovaría con un UPDATE. Aquí la fecha, el cupo de cajas y el
 * plan siempre salen del token firmado por el creador.
 *
 * No lanza: devuelve `null` cuando no hay llave pública, la firma no cuadra, el
 * token es de otra instalación o no incluye esta tienda. `ignoreExpiration` es
 * deliberado: la vigencia la decide `calcularEstadoLicencia` para poder mostrar
 * el periodo de gracia.
 */
export function leerTokenLicencia(
  token: string | null | undefined,
  codigoInstalacion: string,
  storeCode: string
): LicenciaDelToken | null {
  const llave = llavePublica();
  if (!llave || !token) return null;

  let payload: ContenidoToken;
  try {
    payload = jwt.verify(token.trim(), llave, {
      algorithms: ['RS256'],
      ignoreExpiration: true,
      clockTolerance: 60,
    }) as ContenidoToken;
  } catch {
    return null;
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.inst !== 'string' ||
    typeof payload.exp !== 'number' ||
    !Array.isArray(payload.stores)
  ) {
    return null;
  }

  if (normalizarCodigoInstalacion(payload.inst) !== normalizarCodigoInstalacion(codigoInstalacion)) {
    return null;
  }

  const entrada = payload.stores.find(
    (t) => String(t?.code ?? '').trim().toUpperCase() === storeCode.trim().toUpperCase()
  );
  if (!entrada) return null;

  const expiresAt = new Date(payload.exp * 1000);
  if (Number.isNaN(expiresAt.getTime())) return null;

  return {
    expiresAt,
    graceDays:
      typeof payload.gracia === 'number' && payload.gracia >= 0
        ? Math.trunc(payload.gracia)
        : DIAS_GRACIA_POR_DEFECTO,
    maxCajas: Math.max(1, Math.trunc(entrada.maxCajas ?? 1)),
    plan: entrada.plan?.trim() || 'PRO',
    folio: payload.folio ?? null,
    issuedTo: payload.cliente ?? null,
  };
}

/**
 * Canjea un token firmado: valida firma, instalación y tiendas, actualiza la
 * licencia comercial y sincroniza las licencias operativas de las cajas.
 */
export async function activarLicencia(token: string, userId?: string | null) {
  const payload = verificarToken(token);
  const instalacion = await obtenerInstalacion();

  const codigoLocal = formatearCodigoInstalacion(instalacion.id);
  if (normalizarCodigoInstalacion(payload.inst) !== normalizarCodigoInstalacion(codigoLocal)) {
    throw ApiError.badRequest(
      'El código de licencia pertenece a otra instalación. Verifica el código de instalación.',
      'LICENCIA_OTRA_INSTALACION'
    );
  }

  const { efectiva } = await contextoDeTiempo(instalacion);
  const expira = new Date(payload.exp * 1000);
  if (Number.isNaN(expira.getTime())) {
    throw ApiError.badRequest('El código de licencia tiene una vigencia inválida.', 'LICENCIA_TOKEN_INVALIDO');
  }
  if (expira.getTime() <= efectiva.getTime()) {
    throw ApiError.badRequest(
      'El código de licencia ya venció. Solicita uno nuevo.',
      'LICENCIA_TOKEN_VENCIDO'
    );
  }

  const startsAt = payload.iat ? new Date(payload.iat * 1000) : efectiva;
  const graceDays =
    typeof payload.gracia === 'number' && payload.gracia >= 0
      ? Math.trunc(payload.gracia)
      : DIAS_GRACIA_POR_DEFECTO;

  const tiendas: {
    storeId: string;
    code: string;
    name: string;
    plan: string;
    maxCajas: number;
    cajasLicenciadas: number;
  }[] = [];
  const advertencias: string[] = [];

  for (const entrada of payload.stores) {
    const code = String(entrada.code ?? '').trim().toUpperCase();
    if (!code) {
      advertencias.push('El código incluye una tienda sin identificador.');
      continue;
    }

    const store = await prisma.store.findUnique({ where: { code } });
    if (!store) {
      advertencias.push(`La tienda ${code} no existe en esta instalación.`);
      continue;
    }

    const plan = entrada.plan?.trim() || 'PRO';
    const maxCajas = Math.max(1, Math.trunc(entrada.maxCajas ?? 1));

    const licencia = await prisma.storeLicense.upsert({
      where: { storeId: store.id },
      create: {
        storeId: store.id,
        folio: payload.folio ?? null,
        plan,
        maxCajas,
        issuedTo: payload.cliente ?? null,
        startsAt,
        expiresAt: expira,
        graceDays,
        status: LicenseStatus.ACTIVE,
        token: token.trim(),
        tokenHash: sha256(token.trim()),
        activatedAt: new Date(),
        activatedById: userId ?? null,
      },
      update: {
        folio: payload.folio ?? null,
        plan,
        maxCajas,
        issuedTo: payload.cliente ?? null,
        startsAt,
        expiresAt: expira,
        graceDays,
        status: LicenseStatus.ACTIVE,
        token: token.trim(),
        tokenHash: sha256(token.trim()),
        activatedAt: new Date(),
        activatedById: userId ?? null,
      },
    });

    const cajasLicenciadas = await sincronizarCajasDeTienda(
      store.id,
      licencia.id,
      maxCajas,
      expira,
      userId ?? null
    );

    tiendas.push({
      storeId: store.id,
      code: store.code,
      name: store.name,
      plan,
      maxCajas,
      cajasLicenciadas,
    });

    await audit({
      storeId: store.id,
      userId: userId ?? undefined,
      action: 'LICENCIA_ACTIVADA',
      entity: 'STORE_LICENSE',
      entityId: licencia.id,
      metadata: {
        folio: payload.folio ?? null,
        plan,
        maxCajas,
        expiraEl: expira.toISOString(),
      },
    });

    await registrarEvento('ACTIVACION', {
      storeId: store.id,
      storeLicenseId: licencia.id,
      userId: userId ?? null,
      mensaje: `Licencia ${payload.folio ?? 'sin folio'} activada hasta ${expira
        .toISOString()
        .slice(0, 10)}.`,
      metadata: { plan, maxCajas, cajasLicenciadas },
    });

    emitToStore(store.id, 'license:updated', { storeId: store.id, estado: 'ACTIVE' });
  }

  if (!tiendas.length) {
    throw ApiError.badRequest(
      'El código no incluye ninguna tienda de esta instalación.',
      'LICENCIA_SIN_TIENDAS'
    );
  }

  await prisma.installation.update({
    where: { id: instalacion.id },
    data: { licenseToken: token.trim() },
  });

  return {
    folio: payload.folio ?? null,
    cliente: payload.cliente ?? null,
    instalacion: codigoLocal,
    expiraEl: expira.toISOString(),
    graceDays,
    tiendas,
    advertencias,
  };
}

/**
 * Ajusta las licencias operativas de una tienda al cupo de la licencia:
 * renueva las existentes, asigna las que falten a las cajas activas más
 * antiguas y quita las que sobren (las más recientes).
 */
async function sincronizarCajasDeTienda(
  storeId: string,
  storeLicenseId: string,
  maxCajas: number,
  expira: Date,
  userId: string | null
): Promise<number> {
  const licenciadas = await prisma.cajaLicense.findMany({
    where: { storeId },
    orderBy: { activatedAt: 'asc' },
  });

  for (const licencia of licenciadas) {
    await prisma.cajaLicense.update({
      where: { id: licencia.id },
      data: {
        storeLicenseId,
        expiresAt: expira,
        status: LicenseStatus.ACTIVE,
      },
    });
  }

  const faltan = maxCajas - licenciadas.length;
  if (faltan > 0) {
    const libres = await prisma.caja.findMany({
      where: { storeId, license: null },
      orderBy: { createdAt: 'asc' },
      take: faltan,
    });
    for (const caja of libres) {
      await prisma.cajaLicense.create({
        data: {
          storeId,
          storeLicenseId,
          cajaId: caja.id,
          expiresAt: expira,
          status: LicenseStatus.ACTIVE,
          activatedById: userId,
        },
      });
    }
  } else if (faltan < 0) {
    const sobran = licenciadas.slice(maxCajas);
    if (sobran.length) {
      await prisma.cajaLicense.deleteMany({
        where: { id: { in: sobran.map((l) => l.id) } },
      });
    }
  }

  return prisma.cajaLicense.count({ where: { storeId } });
}

// -----------------------------------------------------------------------------
// Eventos y resúmenes
// -----------------------------------------------------------------------------

async function registrarEvento(
  tipo: string,
  data: {
    storeId?: string | null;
    storeLicenseId?: string | null;
    userId?: string | null;
    mensaje?: string | null;
    metadata?: Prisma.InputJsonValue;
  }
): Promise<void> {
  try {
    await prisma.licenseEvent.create({
      data: {
        tipo,
        storeId: data.storeId ?? null,
        storeLicenseId: data.storeLicenseId ?? null,
        userId: data.userId ?? null,
        mensaje: data.mensaje ?? null,
        metadata: data.metadata,
      },
    });
  } catch (err) {
    // El historial nunca debe romper la operación.
    logger.warn('No se pudo registrar el evento de licencia', { err, tipo });
  }
}

export async function listarEventosLicencia(storeId: string, limit = 50) {
  const eventos = await prisma.licenseEvent.findMany({
    where: { storeId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      tipo: true,
      mensaje: true,
      metadata: true,
      createdAt: true,
      userId: true,
    },
  });
  return (eventos ?? []).map((e) => ({
    id: e.id,
    tipo: e.tipo,
    mensaje: e.mensaje,
    metadata: e.metadata,
    userId: e.userId,
    createdAt: e.createdAt,
  }));
}

/** Datos de la instalación para la pantalla de licencias. */
export async function estadoInstalacion() {
  const instalacion = await obtenerInstalacion();
  const modo = modoLicencia();
  return {
    id: instalacion.id,
    codigo: formatearCodigoInstalacion(instalacion.id),
    machineId: instalacion.machineId,
    installedAt: instalacion.installedAt,
    aplica: modo !== 'off',
    modo,
  };
}

/**
 * Resumen de todas las tiendas de la instalación. Solo para el rol SOPORTE
 * (panel del creador): permite ver de un golpe qué está vencido.
 */
export async function resumenLicenciasInstalacion() {
  const modo = modoLicencia();
  const tiendas = await prisma.store.findMany({
    select: { id: true, name: true, code: true, isActive: true },
    orderBy: { name: 'asc' },
  });
  const licencias = (await prisma.storeLicense.findMany()) ?? [];
  const instalacion = await obtenerInstalacion();
  const { efectiva } = modo === 'off'
    ? { efectiva: new Date() }
    : await contextoDeTiempo(instalacion);

  const porTienda = new Map(licencias.map((l) => [l.storeId, l]));
  const conteo = new Map<string, number>();
  const filasCajas = (await prisma.cajaLicense.groupBy({
    by: ['storeId'],
    _count: { _all: true },
  })) as unknown as { storeId: string; _count: { _all: number } }[];
  for (const fila of filasCajas ?? []) {
    conteo.set(fila.storeId, fila._count?._all ?? 0);
  }

  const codigoInstalacion = formatearCodigoInstalacion(instalacion.id);

  return {
    instalacion: codigoInstalacion,
    modo,
    tiendas: (tiendas ?? []).map((tienda) => {
      const fila = porTienda.get(tienda.id) ?? null;
      const cajasLicenciadas = conteo.get(tienda.id) ?? 0;
      // Igual que en `evaluarTienda`: manda el token, no la fila.
      const delToken = fila
        ? leerTokenLicencia(fila.token, codigoInstalacion, tienda.code)
        : null;

      if (!fila || !delToken) {
        return {
          storeId: tienda.id,
          name: tienda.name,
          code: tienda.code,
          isActive: tienda.isActive,
          estado: 'SIN_LICENCIA' as EstadoLicenciaCodigo,
          plan: null,
          expiresAt: null,
          diasRestantes: null,
          maxCajas: 0,
          cajasLicenciadas,
        };
      }

      const estado = calcularEstadoLicencia(
        delToken.expiresAt,
        delToken.graceDays,
        efectiva,
        fila.status
      );
      return {
        storeId: tienda.id,
        name: tienda.name,
        code: tienda.code,
        isActive: tienda.isActive,
        estado,
        plan: delToken.plan,
        expiresAt: delToken.expiresAt,
        diasRestantes: diasHasta(delToken.expiresAt, efectiva),
        maxCajas: delToken.maxCajas,
        cajasLicenciadas,
      };
    }),
  };
}

/**
 * Revisión diaria (cron): avisa por socket las licencias por vencer y guarda
 * la transición de estado cuando una licencia entra en gracia o vence.
 */
export async function revisarLicencias(): Promise<{ avisadas: number; vencidas: number }> {
  if (modoLicencia() === 'off') return { avisadas: 0, vencidas: 0 };

  const instalacion = await obtenerInstalacion();
  const { efectiva } = await contextoDeTiempo(instalacion);
  const codigoInstalacion = formatearCodigoInstalacion(instalacion.id);
  const tiendas = await prisma.store.findMany({ select: { id: true, code: true } });
  const codigoPorTienda = new Map((tiendas ?? []).map((t) => [t.id, t.code]));
  const licencias = await prisma.storeLicense.findMany();
  let avisadas = 0;
  let vencidas = 0;

  for (const licencia of licencias ?? []) {
    const code = codigoPorTienda.get(licencia.storeId);
    const delToken = code
      ? leerTokenLicencia(licencia.token, codigoInstalacion, code)
      : null;
    // Sin token válido no hay nada que avisar: la licencia ya no cuenta.
    if (!delToken) continue;

    const estado = calcularEstadoLicencia(
      delToken.expiresAt,
      delToken.graceDays,
      efectiva,
      licencia.status
    );
    const dias = diasHasta(delToken.expiresAt, efectiva);

    if (estado !== licencia.status) {
      await prisma.storeLicense.update({
        where: { id: licencia.id },
        data: { status: estado },
      });
      await registrarEvento('CAMBIO_ESTADO', {
        storeId: licencia.storeId,
        storeLicenseId: licencia.id,
        mensaje: `La licencia pasó a ${estado}.`,
        metadata: { estado, diasRestantes: dias },
      });
      if (estado === LicenseStatus.EXPIRED) vencidas += 1;
    }

    if (DIAS_DE_AVISO.includes(dias) && estado === LicenseStatus.ACTIVE) {
      emitToStore(licencia.storeId, 'license:expiring', {
        storeId: licencia.storeId,
        diasRestantes: dias,
        expiraEl: delToken.expiresAt.toISOString(),
        plan: delToken.plan,
      });
      avisadas += 1;
    }
  }

  return { avisadas, vencidas };
}
