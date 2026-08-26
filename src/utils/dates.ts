import { ApiError } from './ApiError';

// Las fechas "YYYY-MM-DD" se interpretan en hora local del servidor; si se
// usara new Date(str) quedarían ancladas a medianoche UTC y el día cambiaría
// en zonas horarias al este/oeste de UTC.
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

// El servidor corre en la zona horaria del negocio (México, p. ej.
// America/Mazatlan UTC-7 u America/Mexico_City UTC-6). En lugar de fijar un
// offset arbitrario, calculamos el "día de negocio" con la hora local real del
// servidor. Así el corte de caja, el cierre de caja y la fecha "hoy" del
// frontend (que también usa la hora local del cliente, en la misma zona) coinciden
// y una venta hecha el martes a las 23:30 se contabiliza el martes, no el miércoles.
function mexicoDateParts(dateStr?: string): { y: number; mo: number; d: number } {
  if (dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) throw ApiError.badRequest('Fecha inválida', 'INVALID_DATE');
    return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
  }
  const n = new Date();
  return { y: n.getFullYear(), mo: n.getMonth(), d: n.getDate() };
}

/** Instante de la medianoche LOCAL del servidor (día de México) del día indicado (o de hoy). */
export function mexicoStartOfDay(dateStr?: string): Date {
  const { y, mo, d } = mexicoDateParts(dateStr);
  return new Date(y, mo, d);
}

/** Último milisegundo del día local del servidor (día de México) indicado (o de hoy). */
export function mexicoEndOfDay(dateStr?: string): Date {
  return new Date(mexicoStartOfDay(dateStr).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Etiqueta "YYYY-MM-DD" del día local del servidor (México) correspondiente al instante dado. */
export function mexicoLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface RangoMexico {
  desde: Date;
  hasta: Date;
}

/** Construye un rango [desde, hasta] en día local del servidor (México) a partir de filtros. */
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
