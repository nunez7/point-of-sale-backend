import { ApiError } from './ApiError';

// Las fechas "YYYY-MM-DD" se interpretan en hora local del servidor; si se
// usara new Date(str) quedarían ancladas a medianoche UTC y el día cambiaría
// en zonas horarias al este/oeste de UTC (p. ej. México, UTC-6).
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

// México es UTC-6 (horario estándar de México, sin cambio de horario desde
// 2022) y no tiene horario de verano. Anclar los límites del día a esta zona
// hace que "YYYY-MM-DD" signifique siempre el día calendario de México, sin
// importar la zona horaria del servidor. Esto evita el síntoma de "selecting
// mañana muestra los datos de hoy" cuando el servidor corre en UTC.
export const MEXICO_OFFSET_MS = 6 * 60 * 60 * 1000;

function mexicoDateParts(dateStr?: string): { y: number; mo: number; d: number } {
  if (dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) throw ApiError.badRequest('Fecha inválida', 'INVALID_DATE');
    return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
  }
  // Fecha actual en México, independiente de la zona del servidor.
  // México es UTC-6, así que restamos el offset al instante UTC.
  const mex = new Date(Date.now() - MEXICO_OFFSET_MS);
  return { y: mex.getUTCFullYear(), mo: mex.getUTCMonth(), d: mex.getUTCDate() };
}

/** Instante UTC de la medianoche de México del día indicado (o de hoy). */
export function mexicoStartOfDay(dateStr?: string): Date {
  const { y, mo, d } = mexicoDateParts(dateStr);
  return new Date(Date.UTC(y, mo, d) + MEXICO_OFFSET_MS);
}

/** Instante UTC del último milisegundo del día de México indicado (o de hoy). */
export function mexicoEndOfDay(dateStr?: string): Date {
  return new Date(mexicoStartOfDay(dateStr).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Etiqueta "YYYY-MM-DD" del día de México correspondiente al instante dado.
 *  México es UTC-6, por eso se resta el offset al instante UTC. */
export function mexicoLocalDateKey(date: Date): string {
  const mex = new Date(date.getTime() - MEXICO_OFFSET_MS);
  const y = mex.getUTCFullYear();
  const m = String(mex.getUTCMonth() + 1).padStart(2, '0');
  const day = String(mex.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface RangoMexico {
  desde: Date;
  hasta: Date;
}

/** Construye un rango [desde, hasta] en día de México a partir de filtros. */
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
