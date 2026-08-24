import { ApiError } from './ApiError';

// Las fechas "YYYY-MM-DD" se interpretan en hora local del servidor; si se
// usara new Date(str) quedarían ancladas a medianoche UTC y el día cambiaría
// en zonas horarias al este/oeste de UTC (p. ej. Colombia, UTC-5).
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

// Colombia es UTC-5 y no tiene horario de verano. Anclar los límites del día a
// esta zona hace que "YYYY-MM-DD" signifique siempre el día calendario de
// Colombia, sin importar la zona horaria del servidor. Esto evita el síntoma de
// "selecting mañana muestra los datos de hoy" cuando el servidor corre en UTC.
export const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000;

function colombiaDateParts(dateStr?: string): { y: number; mo: number; d: number } {
  if (dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) throw ApiError.badRequest('Fecha inválida', 'INVALID_DATE');
    return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
  }
  // Fecha actual en Colombia, independiente de la zona del servidor.
  const col = new Date(Date.now() + COLOMBIA_OFFSET_MS);
  return { y: col.getUTCFullYear(), mo: col.getUTCMonth(), d: col.getUTCDate() };
}

/** Instante UTC de la medianoche de Colombia del día indicado (o de hoy). */
export function colombiaStartOfDay(dateStr?: string): Date {
  const { y, mo, d } = colombiaDateParts(dateStr);
  return new Date(Date.UTC(y, mo, d) + COLOMBIA_OFFSET_MS);
}

/** Instante UTC del último milisegundo del día de Colombia indicado (o de hoy). */
export function colombiaEndOfDay(dateStr?: string): Date {
  return new Date(colombiaStartOfDay(dateStr).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Etiqueta "YYYY-MM-DD" del día de Colombia correspondiente al instante dado. */
export function colombiaLocalDateKey(date: Date): string {
  const col = new Date(date.getTime() + COLOMBIA_OFFSET_MS);
  const y = col.getUTCFullYear();
  const m = String(col.getUTCMonth() + 1).padStart(2, '0');
  const day = String(col.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface RangoColombia {
  desde: Date;
  hasta: Date;
}

/** Construye un rango [desde, hasta] en día de Colombia a partir de filtros. */
export function rangoColombia(opts: {
  startDate?: string;
  endDate?: string;
  date?: string;
}): RangoColombia {
  const base = opts.date ?? opts.startDate ?? opts.endDate;
  return {
    desde: colombiaStartOfDay(opts.startDate ?? base),
    hasta: colombiaEndOfDay(opts.endDate ?? base),
  };
}
