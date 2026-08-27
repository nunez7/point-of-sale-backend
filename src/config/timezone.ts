export const TIMEZONE = 'America/Mazatlan';
export const UTC_OFFSET_HOURS = -7;

export function getCurrentDateInTz(date?: Date): Date {
  const d = date ?? new Date();
  // Adjust time by the timezone offset to simulate the target timezone
  // America/Mazatlan is UTC-7 (standard) or UTC-6 (DST), using fixed -7 for simplicity
  const offsetMs = UTC_OFFSET_HOURS * 60 * 60 * 1000;
  return new Date(d.getTime() + offsetMs);
}

export function getCurrentDateKeyInTz(date?: Date): string {
  const d = getCurrentDateInTz(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getCurrentDateTimeInTz(date?: Date): string {
  const d = getCurrentDateInTz(date);
  return d.toISOString();
}