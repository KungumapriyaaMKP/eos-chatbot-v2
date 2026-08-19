/**
 * Lightweight, dependency-free fuzzy string matching — no external library,
 * keeping with the "fully offline, no extra services" spirit of the rest of
 * this project. Used wherever a chat message names an entity (a subject, a
 * class section, a student) that has to be resolved against the database
 * despite typos, abbreviations, or slightly different wording than what's
 * stored — e.g. "dbms" / "dbsm" / "database mgmt" all resolving to
 * "Database Management System".
 */

/** Classic Levenshtein edit distance (insertions/deletions/substitutions). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const currRow = [i];
    for (let j = 1; j <= b.length; j++) {
      currRow[j] =
        a[i - 1] === b[j - 1]
          ? prevRow[j - 1]
          : 1 + Math.min(prevRow[j - 1], prevRow[j], currRow[j - 1]);
    }
    prevRow = currRow;
  }

  return prevRow[b.length];
}

/** Normalized similarity in [0, 1] — 1 means identical, 0 means completely different. */
export function similarity(a: string, b: string): number {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.length === 0 && y.length === 0) return 1;
  const maxLen = Math.max(x.length, y.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(x, y) / maxLen;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Common filler words that show up in both chat messages ("attendance FOR
 * 23IT001") and real entity names ("English FOR Communication", "Introduction
 * TO Programming"). Without excluding these from the per-word comparison
 * pass below, a message that merely happens to contain "for" would score a
 * perfect 1.0 match against ANY candidate whose name also contains "for" —
 * a real bug this list exists to prevent, not stylistic cleanup.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'are', 'my', 'your',
  'their', 'his', 'her', 'show', 'give', 'me', 'tell', 'what', 'get', 'please', 'can', 'you', 'i',
  'with', 'about',
  // Generic academic-naming words shared across many otherwise-unrelated
  // subjects ("Elective - DevOps", "Elective - Blockchain Technology", ...
  // — every elective shares "elective"). Without excluding these, the
  // per-word match below gives EVERY elective a perfect 1.0 score off that
  // one shared word alone, before the actual differentiating word ever
  // gets compared — confirmed live: "Elective - Devops" matched
  // "Elective - Blockchain Technology" instead of "Elective - DevOps"
  // itself, purely because "elective" is a substring/word match against
  // every candidate and ties resolve to whichever the DB happened to
  // return first.
  'elective', 'electives', 'core', 'lab', 'laboratory',
  // "internal" (as in "Internal Assessment 1") vs "Internet" (as in a real
  // subject "Internet of Things") — real bug found live: Levenshtein
  // similarity between the two 8-letter words is 0.75 (differ only in
  // their last two letters), clearing the 0.72 fuzzy threshold. "give me
  // my internal assessment 1 marks" was silently narrowing to ONLY the
  // "Internet of Things" subject instead of showing every subject's IA1,
  // purely because the exam-type wording itself happened to fuzzy-collide
  // with an unrelated subject's name. "internal"/"internals" is exam
  // terminology, never a genuine subject-name word, so excluding it here
  // costs nothing.
  'internal', 'internals',
]);

/**
 * Best-effort "does this candidate's code(s) or name appear (even fuzzily)
 * in the message" score. `codes` are compared token-by-token (good for
 * short identifiers like subject codes, class labels, or a student's
 * ID/roll/register number — pass all the codes a candidate could
 * legitimately be identified by). `name` is compared both as a
 * whole-string substring (fast path, exact) and via a sliding word-window
 * over the message (typo-tolerant, handles multi-word names like "Database
 * Management System" or "Ganesh A").
 */
function candidateScore(message: string, tokens: string[], fields: { codes?: string[]; name?: string }): number {
  let best = 0;

  for (const code of fields.codes ?? []) {
    if (!code) continue;
    const lower = code.toLowerCase();
    for (const token of tokens) {
      if (STOPWORDS.has(token)) continue;

      // Digits in a structured code (subject code, student ID, roll/register
      // number) are the actual differentiator between otherwise-identical-
      // looking entities — CS101 vs CS102 vs CS001 are different subjects
      // ENTIRELY, not typo variants of each other, and the same goes for
      // adjacent student IDs like 23IT001 vs 23IT101. Plain Levenshtein
      // similarity doesn't know that: "cs001" vs "cs101" is a single edit in
      // a 5-character string, scoring a comfortable 0.8 — well past the
      // 0.72 threshold. Confirmed real bug: asking about a nonexistent
      // "CS001" silently returned marks for the real, different "CS101"
      // with no indication CS001 wasn't found. If both the token and the
      // candidate code contain digits, those digit sequences must match
      // EXACTLY before Levenshtein tolerance is allowed to apply to the
      // rest (the letter prefix, where genuine typos — "cs"/"sc", a missing
      // letter — are still forgiven).
      const tokenDigits = token.replace(/[^0-9]/g, '');
      const codeDigits = lower.replace(/[^0-9]/g, '');
      if (tokenDigits && codeDigits && tokenDigits !== codeDigits) continue;

      best = Math.max(best, similarity(token, lower));
    }
  }

  if (fields.name) {
    const name = fields.name.toLowerCase();
    if (message.toLowerCase().includes(name)) {
      return 1; // exact substring — can't do better than that
    }

    const nameWords = tokenize(name);

    // Whole-name window match: handles "Ganesh A" against a message
    // mentioning both words, in order, even with a typo in one of them.
    for (let i = 0; i <= tokens.length - nameWords.length; i++) {
      const window = tokens.slice(i, i + nameWords.length).join(' ');
      best = Math.max(best, similarity(window, name));
    }

    // Per-word match: handles a query that only gives ONE part of the name
    // ("show fees for Ganesh") — compare each message token against each
    // individual word of the candidate's name, not the name as a whole.
    // Skips short words (initials like "A") and stopwords (see STOPWORDS)
    // on BOTH sides, so a filler word shared by the message and the name
    // ("for" in "attendance for 23IT001" vs "English for Communication")
    // can't produce a false 1.0 match.
    for (const token of tokens) {
      if (token.length < 3 || STOPWORDS.has(token)) continue;
      for (const word of nameWords) {
        if (word.length < 3 || STOPWORDS.has(word)) continue;
        best = Math.max(best, similarity(token, word));
      }
    }
  }

  return best;
}

/**
 * Finds the best fuzzy match for a free-text message among a list of
 * candidates, above `threshold` (default 0.72 — tolerant of one or two
 * typos in a short word, strict enough to avoid false positives on
 * unrelated words). Returns null if nothing clears the bar.
 */
export function fuzzyFindBest<T>(
  message: string,
  candidates: T[],
  getFields: (item: T) => { codes?: string[]; name?: string },
  threshold = 0.72,
): T | null {
  const tokens = tokenize(message);
  if (tokens.length === 0) return null;

  let bestItem: T | null = null;
  let bestScore = threshold;

  for (const candidate of candidates) {
    const score = candidateScore(message, tokens, getFields(candidate));
    if (score > bestScore) {
      bestScore = score;
      bestItem = candidate;
    }
  }

  return bestItem;
}
