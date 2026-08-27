import { ApiError } from './ApiError';
import { TIMEZONE } from '../config/timezone';

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

// El "día de negocio" se calcula en la zona horaria configurada (America/Mazatlan)
// con Intl, independiente del huso horario del sistema operativo del servidor.
function fechaKeyPara(parts: Intl.DateTimeFormatPart[]): string {
  const get = (tipo: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === tipo)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Etiqueta "YYYY-MM-DD" del día en la zona configurada correspondiente al instante dado. */
export function mexicoLocalDateKey(date: Date): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return fechaKeyPara(partes);
}

function mexicoDateParts(dateStr?: string): { y: number; mo: number; d: number } {
  const s = dateStr ?? mexicoLocalDateKey(new Date());
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw ApiError.badRequest('Fecha inválida', 'INVALID_DATE');
  return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
}

// Offset en ms de la zona configurada en el instante dado (ej. "GMT-07:00").
function tzOffsetMs(instante: Date): number {
  const nombre =
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      timeZoneName: 'longOffset',
    })
      .formatToParts(instante)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(nombre);
  if (!m) return 0;
  const direccion = m[1] === '+' ? 1 : -1;
  return direccion * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

/** Instante de la medianoche en la zona horaria configurada (día de negocio) del día indicado (o de hoy). */
export function mexicoStartOfDay(dateStr?: string): Date {
  const { y, mo, d } = mexicoDateParts(dateStr);
  // Offset a mediodía del día indicado: estable salvo cruces de DST.
  const offset = tzOffsetMs(new Date(Date.UTC(y, mo, d, 12)));
  return new Date(Date.UTC(y, mo, d) - offset);
}

/** Último milisegundo del día en la zona horaria configurada (día de México) indicado (o de hoy). */
export function mexicoEndOfDay(dateStr?: string): Date {
  return new Date(mexicoStartOfDay(dateStr).getTime() + 24 * 60 * 60 * 1000 - 1);
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
