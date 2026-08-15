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

/**
 * Reply templates for when classifyIntent() abstains (see
 * intent.classifier.ts — below-threshold OR ambiguous-margin). Previously a
 * single fixed string ("I couldn't understand your question. Please
 * rephrase it.") for every single unmatched message, regardless of how
 * close the classifier actually got or what was asked — reads as robotic
 * and gives the user no signal on whether to try a totally different
 * question or just reword the same one.
 *
 * Two tiers, split at the intent confidence threshold's midpoint-ish (0.35
 * — well below env.intent.confidenceThreshold's default 0.55): "near miss"
 * (the classifier landed somewhere plausible but not confidently enough)
 * gets a tone that invites rewording; "no signal" (score near zero, or no
 * candidate at all) gets a tone that doesn't pretend to have understood
 * anything. Within each tier, picks pseudo-randomly for variety — a chat
 * that says the exact same sentence every time it's confused reads worse
 * than one that varies, even though the underlying capability is identical.
 */
const NEAR_MISS_MESSAGES = [
  "I think I get the general idea, but I'm not confident enough to answer correctly — could you rephrase or add a bit more detail?",
  "That's close to something I understand, but not quite — mind wording it a little differently?",
  "I'm partly following, but not sure enough to give you a reliable answer. Could you be more specific?",
];

const NO_SIGNAL_MESSAGES = [
  "Hmm, I'm not sure what you're asking — could you rephrase that?",
  "Sorry, I didn't quite catch what you need there. Could you try asking it a different way?",
  "That one's unclear to me. Could you reword it?",
];

const NEAR_MISS_THRESHOLD = 0.35;

/** Picks a fallback reply for an unmatched message, varying tone by how close the classifier actually got. */
export function pickLowConfidenceMessage(confidence: number): string {
  const pool = confidence >= NEAR_MISS_THRESHOLD ? NEAR_MISS_MESSAGES : NO_SIGNAL_MESSAGES;
  return pool[Math.floor(Math.random() * pool.length)];
}
