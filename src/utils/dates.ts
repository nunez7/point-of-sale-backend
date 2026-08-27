import { ApiError } from './ApiError';
import { UTC_OFFSET_HOURS, getCurrentDateInTz } from '../config/timezone';

// Las fechas "YYYY-MM-DD" se interpretan en la zona horaria configurada (por defecto America/Mazatlan UTC-7).
// Esto garantiza consistencia entre backend y frontend aun cuando el servidor esté en EE.UU. y el frontend en México.
export function parseLocalDate(dateStr: string): Date {
  const onlyDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (onlyDay) {
    const d = new Date(
      Number(onlyDay[1]),
      Number(onlyDay[2]) - 1,
      Number(onlyDay[3])
    );
    if (isNaN(d.getTime())) throw ApiError.badRequest('Fecha inválida', 'INVALID_DATE');
    return d;
  }
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) throw ApiError.badRequest('Fecha inválida', 'INVALID_DATE');
  return parsed;
}

// Calcula el "día de negocio" en la zona horaria configurada.
// En lugar de usar new Date() (que toma la zona horaria del servidor),
// ajustamos por el offset configurado así la fecha "hoy" es consistente
// independientemente de dónde se despliegue el servidor.
function mexicoDateParts(dateStr?: string): { y: number; mo: number; d: number } {
  if (dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) throw ApiError.badRequest('Fecha inválida', 'INVALID_DATE');
    return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
  }
  const now = getCurrentDateInTz();
  return { y: now.getFullYear(), mo: now.getMonth(), d: now.getDate() };
}

/** Instante de la medianoche en la zona horaria configurada (día de negocio) del día indicado (o de hoy). */
export function mexicoStartOfDay(dateStr?: string): Date {
  const { y, mo, d: day } = mexicoDateParts(dateStr);
  // Crear la fecha y ajustar al offset de la zona configurada
  const date = new Date(y, mo, day);
  const offsetMs = UTC_OFFSET_HOURS * 60 * 60 * 1000;
  return new Date(date.getTime() + offsetMs);
}

/** Último milisegundo del día en la zona horaria configurada (día de México) indicado (o de hoy). */
export function mexicoEndOfDay(dateStr?: string): Date {
  return new Date(mexicoStartOfDay(dateStr).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Etiqueta "YYYY-MM-DD" del día en la zona horaria configurada correspondiente al instante dado. */
export function mexicoLocalDateKey(date: Date): string {
  // First adjust the date to the configured timezone, then extract components
  const adjusted = new Date(date.getTime() + UTC_OFFSET_HOURS * 60 * 60 * 1000);
  const y = adjusted.getFullYear();
  const m = String(adjusted.getMonth() + 1).padStart(2, '0');
  const day = String(adjusted.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface RangoMexico {
  desde: Date;
  hasta: Date;
}

/** Construye un rango [desde, hasta] en día de la zona horaria configurada a partir de filtros. */
export function rangoMexico(opts: {
  startDate?: string;
  endDate?: string;
  date?: string;
}): RangoMexico {
  const base = opts.date ?? opts.startDate ?? opts.endDate;
  return {
    desde: mexicoStartOfDay(opts.startDate ?? base),
    hasta: mexicoEndOfDay(opts.endDate ?? base),
  };
}
