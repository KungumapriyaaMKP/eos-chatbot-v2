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

export const NO_PERMISSION_MESSAGE =
  "Sorry, you don't have permission to access this information.";

export const LOW_CONFIDENCE_MESSAGE =
  "I couldn't understand your question. Please rephrase it.";
