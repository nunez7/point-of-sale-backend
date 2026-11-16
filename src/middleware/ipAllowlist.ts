import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { ApiError } from '../utils/ApiError';

/**
 * Normaliza una dirección IP para poder compararla:
 * - '::ffff:127.0.0.1' (IPv4 mapeada en IPv6) → '127.0.0.1'
 * - '::1' (loopback IPv6) → '127.0.0.1'
 * Así una misma petición local se autoriza con una sola entrada de ALLOWED_IPS.
 */
export function normalizeIp(raw?: string | null): string {
  if (!raw) return '';
  let ip = raw.trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

function matches(allowed: string, ip: string): boolean {
  const entry = normalizeIp(allowed);
  if (!entry) return false;
  if (entry === '*') return true;
  if (entry.endsWith('*')) return ip.startsWith(entry.slice(0, -1));
  return entry === ip;
}

/**
 * Indica si una IP está autorizada según ALLOWED_IPS.
 * Lista vacía = control desactivado (se rechaza en producción desde env.ts).
 */
export function isIpAllowed(raw?: string | null): boolean {
  if (env.ALLOWED_IPS.length === 0) return true;
  const ip = normalizeIp(raw);
  if (!ip) return false;
  return env.ALLOWED_IPS.some((allowed) => matches(allowed, ip));
}

/**
 * Rechaza con 403 cualquier petición HTTP que no venga de una IP autorizada.
 * Se monta antes de CORS para que una IP bloqueada no reciba ni cabeceras CORS.
 */
export const ipAllowlist = (req: Request, _res: Response, next: NextFunction): void => {
  // El health check queda exento para no romper monitores externos.
  if (req.path === '/health') {
    next();
    return;
  }

  const ip = req.ip ?? req.socket.remoteAddress;

  if (isIpAllowed(ip)) {
    next();
    return;
  }

  logger.warn(
    `Acceso denegado por IP no autorizada: ${ip ?? 'desconocida'} → ${req.method} ${req.originalUrl}`,
  );
  next(ApiError.forbidden('Acceso denegado desde IP no autorizada', 'IP_NOT_ALLOWED'));
};
