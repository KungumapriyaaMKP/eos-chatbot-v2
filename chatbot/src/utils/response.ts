export interface ChatReply {
  reply: string;
  intent: string | null;
  confidence: number;
  data?: unknown;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatHHMM(date: Date): string {
  return date.toISOString().slice(11, 16);
}

export function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** timetable_slots.day_of_week convention: 1=Monday..6=Saturday (see EOS-backend TimetableService). */
export function dayOfWeekName(day: number): string {
  return DAY_NAMES[day] ?? `Day ${day}`;
}

/**
 * Ends a sentence with a period, without ever producing a double period.
 * Names can legitimately end in punctuation already ("Ganesh A." — an
 * abbreviated surname), so a naive `${text}.` risks "...for Ganesh A..".
 */
export function endSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Joins a list into "a, b and c" — reads more naturally in a chat reply than a raw comma-list. */
export function joinNaturally(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Renders a GitHub-flavored-markdown table — the frontend (public/index.html)
 * detects this exact shape (a line starting with `|`, followed by a
 * `|---|---|`-style separator line) and renders it as a real HTML `<table>`
 * instead of showing the raw pipe/dash syntax as text. Used for any reply
 * with 2+ columns and 2+ rows (marks, timetable, a roster, ...) — a single
 * fact ("your attendance is 82%") stays plain prose, a table doesn't help there.
 *
 * Cell values are stringified and `|` is escaped so a name or subject that
 * happens to contain a pipe can't break the table's column structure.
 */
export function markdownTable(headers: string[], rows: Array<Array<string | number>>): string {
  const cell = (v: string | number) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const headerLine = `| ${headers.map(cell).join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((row) => `| ${row.map(cell).join(' | ')} |`);
  return [headerLine, separatorLine, ...rowLines].join('\n');
}

export const NO_PERMISSION_MESSAGE =
  "Sorry, you don't have permission to access this information.";

export const LOW_CONFIDENCE_MESSAGE =
  "I couldn't understand your question. Please rephrase it.";
