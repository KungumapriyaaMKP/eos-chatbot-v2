/**
 * Best-effort "which date is this message actually about" parser.
 *
 * Real gap found live: "who are all absent on 2026-07-29" correctly
 * classified as faculty_class_attendance, but the handler was hardcoded to
 * always use TODAY's date — the specific date in the message was never
 * even looked at. The training dataset already has real examples using
 * "yesterday", "last friday", "on 21 july" (see faculty_class_attendance's
 * examples), but nothing anywhere ever actually parsed those into a real
 * date to filter by — every one of those phrasings was silently treated
 * identically to "no date mentioned at all".
 *
 * Returns null (meaning: no specific date found, caller should default to
 * today) rather than guessing — same "no confident match beats no match"
 * stance as matchSubjectInMessage/matchExamTypeInMessage/
 * matchSemesterInMessage.
 */

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Midnight-UTC boundary — matches how `@db.Date` columns are stored, no time-of-day component to worry about. */
function dateOnlyUTC(source: Date): Date {
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

/**
 * The most recent occurrence of `targetDow` strictly BEFORE today — "last
 * friday" said on a Friday means the PREVIOUS Friday, not today, hence the
 * `|| 7` (a same-day match forces a full week back, not a zero-day diff).
 */
function mostRecentWeekdayBefore(today: Date, targetDow: number): Date {
  const diff = (today.getUTCDay() - targetDow + 7) % 7 || 7;
  const result = new Date(today);
  result.setUTCDate(result.getUTCDate() - diff);
  return result;
}

export function matchDateInMessage(message: string, now: Date = new Date()): Date | null {
  const lower = message.toLowerCase();
  const today = dateOnlyUTC(now);

  // ISO format: 2026-07-29
  const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const parsed = new Date(Date.UTC(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10)));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  if (/\byesterday\b/.test(lower)) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }

  if (/\btoday\b/.test(lower)) {
    return today;
  }

  // "tomorrow" — every prior caller here (attendance) only ever looked
  // backward, so this was never needed until get_holidays needed to answer
  // "is tomorrow a holiday" / "do I have class tomorrow" directly instead
  // of just dumping the next 8 upcoming holidays and making the user scan
  // for tomorrow's date themselves.
  if (/\btomorrow\b|\btmrw\b/.test(lower)) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }

  for (let dow = 0; dow < WEEKDAY_NAMES.length; dow++) {
    if (new RegExp(`\\blast ${WEEKDAY_NAMES[dow]}\\b`).test(lower)) {
      return mostRecentWeekdayBefore(today, dow);
    }
  }

  // "21 july" / "21st july" / "july 21" — day and month name, either order.
  for (let m = 0; m < MONTH_NAMES.length; m++) {
    const month = MONTH_NAMES[m];
    const dayFirst = lower.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${month}\\b`));
    const monthFirst = lower.match(new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
    const dayStr = dayFirst?.[1] ?? monthFirst?.[1];
    if (!dayStr) continue;

    const day = parseInt(dayStr, 10);
    if (day < 1 || day > 31) continue;

    // No year mentioned — assume the current year, unless that would put
    // the date in the FUTURE relative to "now" (a bare "21 july" almost
    // always means the most recent one, not next year's).
    const year = now.getUTCFullYear();
    const candidate = new Date(Date.UTC(year, m, day));
    return candidate.getTime() > today.getTime() ? new Date(Date.UTC(year - 1, m, day)) : candidate;
  }

  return null;
}
