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
