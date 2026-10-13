/**
 * Deadlines are stored as plain calendar dates ("YYYY-MM-DD") in the user's local time,
 * so a deadline never shifts with time zones or daylight saving.
 */

export const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayISO = () => toISODate(new Date());

function parse(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, n: number) {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Whole calendar days from `today` to `due`: 0 = due today, 1 = tomorrow, negative = overdue. */
export function daysUntil(due: string, today: string) {
  return Math.round((parse(due).getTime() - parse(today).getTime()) / 86_400_000);
}

/**
 * - `soon` (orange): 3 days or fewer left
 * - `urgent` (red): 1 day or less left — due tomorrow, today, or overdue
 */
export type DueLevel = 'later' | 'soon' | 'urgent';

export function dueLevel(days: number): DueLevel {
  if (days <= 1) return 'urgent';
  if (days <= 3) return 'soon';
  return 'later';
}

export function formatDue(due: string, today: string) {
  const days = daysUntil(due, today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return `${-days} days overdue`;
  const d = parse(due);
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  const sameYear = d.getFullYear() === parse(today).getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A longer description for screen readers and tooltips. */
export function describeDue(due: string, today: string) {
  const days = daysUntil(due, today);
  const date = parse(due).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  if (days < 0) return `Deadline was ${date} (${-days} day${days === -1 ? '' : 's'} overdue)`;
  if (days === 0) return `Deadline is today, ${date}`;
  return `Deadline ${date}, ${days} day${days === 1 ? '' : 's'} left`;
}

/** Monday of next week (quick pick). */
export function nextMonday(today: string) {
  const d = parse(today);
  const add = ((8 - d.getDay()) % 7) || 7;
  return addDays(today, add);
}
