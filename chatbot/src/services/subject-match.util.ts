import { prisma } from '../utils/prisma';
import { fuzzyFindBest, similarity } from '../utils/fuzzy';

export interface MatchedSubject {
  id: number;
  name: string;
  subject_code: string;
}

/**
 * Common CS-curriculum abbreviations students actually type ("dbms", "oop",
 * "os"...) that DON'T reduce to a subject's plain initials, so no generic
 * acronym algorithm catches them: "Database Management Systems" gives
 * initials "DMS" (one letter from "Database"), not the "DBMS" every real
 * student types. This college's subject_codes are also generic sequential
 * codes (CS101, CS303, ...) carrying no hint of the subject itself, so an
 * abbreviation typed against the NAME is the only way these resolve at all.
 * A known, bounded set — worth naming directly rather than guessing at a
 * generic rule. Each abbreviation maps to the significant words that must
 * ALL appear (fuzzy-tolerant, so a typo in the full word still resolves) in
 * a candidate's name.
 */
const KNOWN_ABBREVIATIONS: Record<string, string[]> = {
  dbms: ['database', 'management'],
  oop: ['object', 'oriented'],
  os: ['operating', 'system'],
  cn: ['computer', 'network'],
  daa: ['design', 'analysis', 'algorithm'],
  toc: ['theory', 'computation'],
  se: ['software', 'engineering'],
  dsa: ['data', 'structure'],
  ai: ['artificial', 'intelligence'],
  ml: ['machine', 'learning'],
  cg: ['computer', 'graphics'],
  dld: ['digital', 'logic'],
};

const WORD_SIMILARITY_FLOOR = 0.75;

function matchesKnownAbbreviation(tokens: string[], nameWords: string[]): boolean {
  for (const token of tokens) {
    const requiredWords = KNOWN_ABBREVIATIONS[token];
    if (!requiredWords) continue;
    const allPresent = requiredWords.every((required) => nameWords.some((w) => similarity(w, required) >= WORD_SIMILARITY_FLOOR));
    if (allPresent) return true;
  }
  return false;
}

async function candidateSubjects(classId?: number | null): Promise<MatchedSubject[]> {
  if (classId == null) {
    return prisma.subjects.findMany({ select: { id: true, name: true, subject_code: true } });
  }
  const rows = await prisma.class_subjects.findMany({
    where: { class_id: classId },
    select: { subjects: { select: { id: true, name: true, subject_code: true } } },
  });
  return rows.map((r) => r.subjects);
}

/**
 * Best-effort "did the user mention a specific subject" check — e.g.
 * "attendance in dbms" or "show my attendance for CS402", including typo'd
 * or abbreviated spellings ("atendance in dbsm", "database mgmt"). Tries an
 * exact subject_code token match first (fastest, most reliable), then a
 * known-abbreviation check (see KNOWN_ABBREVIATIONS above), then falls back
 * to fuzzy matching against both subject_code and subject name. Returns
 * null (meaning: "overall", not subject-specific) when nothing matches
 * confidently — a wrong subject match is worse than no subject match.
 *
 * `classId`, when given, scopes the candidate pool to subjects actually
 * taught in THAT class (via class_subjects) instead of every subject in the
 * institution. This matters a lot in practice: several departments run a
 * same-named course under different codes (confirmed live — "Database
 * Management Systems" exists as both CS303 and AD302, "Operating Systems"
 * as CS304 and AD303). Without class scoping, "dbms" matches BOTH and the
 * abbreviation lookup correctly refuses to guess between them (see below) —
 * class-scoping it resolves that ambiguity for real, since a given class
 * only takes ONE of them. Every caller that has a resolved student/class in
 * hand should pass it; pass nothing only when there's genuinely no scope to
 * narrow by (e.g. an admin question with no student named yet).
 */
export async function matchSubjectInMessage(message: string, classId?: number | null): Promise<MatchedSubject | null> {
  const lower = message.toLowerCase();
  const tokens: string[] = lower.match(/\b[a-z0-9]+\b/g) ?? [];

  const subjects = await candidateSubjects(classId);

  for (const subject of subjects) {
    if (tokens.includes(subject.subject_code.toLowerCase())) {
      return subject;
    }
  }

  const abbreviationMatches = subjects.filter((s) => matchesKnownAbbreviation(tokens, s.name.toLowerCase().split(/\s+/)));
  if (abbreviationMatches.length === 1) {
    return abbreviationMatches[0];
  }
  // More than one subject satisfies the same abbreviation and classId
  // wasn't enough to narrow it to one (or wasn't provided at all) —
  // ambiguous, not a confident match, so fall through rather than guess
  // which one.

  return fuzzyFindBest(message, subjects, (s) => ({ codes: [s.subject_code], name: s.name }));
}

export interface MatchedExamType {
  id: number;
  name: string;
}

/**
 * Common shorthand for exam types ("IA1", "last internal", "semester exam")
 * that bears no textual similarity to the real exam_types.name at all — a
 * pure fuzzy-string match can catch someone typing "Internal Assesment 2"
 * (a typo of the real name), but has no mechanism to know "last internal"
 * means "Internal Assessment II" specifically, since neither word appears
 * in that name. Each pattern maps to a NAME SUBSTRING that must appear
 * (case-insensitively) in a real exam_types.name — not a hardcoded id —
 * so this still works if the exact wording of "Internal Assessment II"
 * ever changes in the data, as long as the I/II numbering convention holds.
 *
 * "last"/"latest"/"final" internal deliberately maps to II, not I — with
 * only two internal assessments per subject in this schema, "the last one"
 * means whichever comes chronologically after the other, which is II by
 * this institution's own naming convention (I before II).
 */
const EXAM_TYPE_PATTERNS: Array<{ pattern: RegExp; nameContains: string }> = [
  // CIA = "Continuous Internal Assessment" — an extremely common alternate
  // name for the same Internal Assessment exams at Indian engineering
  // colleges (this dataset's own training examples literally use "CIA 2
  // mark"), but nothing here recognized it as equivalent to IA/"internal"
  // before this fix — a real gap found live.
  //
  // Every "internal"/"cia"/"assessment"/"exam" token below tolerates an
  // optional trailing "s" (internal**s**, assessment**s**, exam**s**) —
  // real gap found live: "marks in internal**s** 1" (a very natural plural
  // phrasing) silently matched NOTHING, so the exam-type filter was
  // dropped entirely and every exam type's marks were returned instead of
  // just Internal Assessment I.
  { pattern: /\b(ia|cia)s?\s?1\b|\bfirst internals?\b|\b(internal|cia)s?\s?(assessments?\s|exams?\s)?1\b/i, nameContains: 'i' },
  { pattern: /\b(ia|cia)s?\s?2\b|\bsecond internals?\b|\b(last|latest|final)\s+internals?\b|\b(internal|cia)s?\s?(assessments?\s|exams?\s)?2\b/i, nameContains: 'ii' },
  { pattern: /\b(semester|university|sem|final)\s?exams?(ination)?\b/i, nameContains: 'semester' },
  { pattern: /\bmodel\s?exams?(ination)?\b/i, nameContains: 'model' },
];

/**
 * Roman-numeral-aware exact suffix match — "internal assessment i" is a
 * SUBSTRING of "internal assessment ii" (both start with "internal
 * assessment i"), so a plain .includes('i') would false-positive match on
 * "Internal Assessment II" too. Comparing the trailing token exactly
 * (split on whitespace, last word) avoids that.
 */
function nameEndsWithToken(name: string, token: string): boolean {
  const words = name.toLowerCase().trim().split(/\s+/);
  return words[words.length - 1] === token;
}

/**
 * Guards the generic fuzzy-name fallback below from a REAL false-positive
 * found live while wiring this into get_marks: "what are my marks this
 * semester" was matching 'University Semester Examination', because plain
 * per-word fuzzy comparison treats "semester" as a normal, non-stopword
 * token that scores a perfect 1.0 against the word "Semester" inside that
 * name — even though the caller never asked about a specific EXAM at all,
 * just used "semester" in its everyday calendar-time sense. Every real
 * exam_types name (Internal Assessment I/II, University Semester
 * Examination, Model Examination) contains "exam"/"examination" or
 * "assessment" as a substring, so requiring one of those before even
 * attempting the fuzzy fallback costs nothing for genuine exam-type
 * mentions (the shorthand patterns above already catch every OTHER real
 * phrasing) while blocking this specific false-positive class.
 */
const EXAM_SIGNAL_PATTERN = /\b(exam|assessment)/i;

/**
 * Best-effort "did the user ask about a specific exam" check — e.g. "marks
 * in the last internal" or "semester exam results" — moved here (from
 * section-performance.service.ts, the only prior caller) so get_marks can
 * reuse it too instead of always dumping the caller's entire mark history
 * regardless of which single exam they actually asked about. Tries the
 * known-shorthand patterns above first (since those carry no textual
 * overlap with the real name for fuzzy matching to find), then falls back
 * to fuzzy matching against the exam type's actual name — but only when
 * the message actually signals "this is about an exam" at all (see
 * EXAM_SIGNAL_PATTERN), since a bare fuzzy word match is too easily
 * confused by common words like "semester" used in a non-exam sense.
 */
export async function matchExamTypeInMessage(message: string): Promise<MatchedExamType | null> {
  const examTypes = await prisma.exam_types.findMany({ select: { id: true, name: true } });

  for (const { pattern, nameContains } of EXAM_TYPE_PATTERNS) {
    if (!pattern.test(message)) continue;
    const found =
      nameContains === 'i' || nameContains === 'ii'
        ? examTypes.find((e) => nameEndsWithToken(e.name, nameContains))
        : examTypes.find((e) => e.name.toLowerCase().includes(nameContains));
    if (found) return found;
  }

  if (!EXAM_SIGNAL_PATTERN.test(message)) return null;
  return fuzzyFindBest(message, examTypes, (e) => ({ name: e.name }));
}

/**
 * Ordinal/cardinal word forms for "which semester" — a real gap found live:
 * "give my mark in first semester" returned the caller's ENTIRE mark
 * history (85 rows across 6 real semesters for one actual student) because
 * nothing matched semester NUMBER at all — matchSubjectInMessage only
 * handles subject, matchExamTypeInMessage only handles exam type (IA1/IA2/
 * university exam), and `exams.semester` (a real, populated int column)
 * was never consulted by anything.
 */
const SEMESTER_ORDINAL_WORDS: Record<string, number> = {
  first: 1, one: 1,
  second: 2, two: 2,
  third: 3, three: 3,
  fourth: 4, four: 4,
  fifth: 5, five: 5,
  sixth: 6, six: 6,
  seventh: 7, seven: 7,
  eighth: 8, eight: 8,
};

/**
 * "previous"/"last semester" — a real gap found live: unlike "first
 * semester"/"semester 3" (an absolute number, resolvable from the text
 * alone), "previous"/"last" is RELATIVE to the caller's own current
 * semester, which the message itself never states — resolving it needs
 * the caller's actual current_semester as context. Deliberately excludes
 * "final"/"latest" (already claimed by EXAM_TYPE_PATTERNS above for "final
 * internal" meaning Internal Assessment II — reusing them here for
 * semester would be genuinely ambiguous between the two meanings).
 */
const RELATIVE_PREVIOUS_SEMESTER_PATTERN = /\b(previous|last)\s+sem(ester)?\b/i;

/**
 * Deliberately requires "semester"/"sem" directly adjacent to the number/
 * ordinal (not just present anywhere in the message) — the whole point is
 * to avoid a bare ordinal used in an unrelated sense ("my second attempt",
 * "third subject") being mistaken for a semester reference. Handles both
 * orders ("semester 3" / "3rd semester") and both numeric ("3", "3rd") and
 * word ("third") forms, plus "previous"/"last semester" relative to
 * `currentSemester` (the caller's own current_semester, when the caller
 * passes it — omitted, this form is simply not resolved, same as any
 * other unmatched phrasing). Returns null (meaning: don't filter by
 * semester) when nothing matches — same "no confident match beats no
 * match" stance as matchSubjectInMessage/matchExamTypeInMessage.
 */
export function matchSemesterInMessage(message: string, currentSemester?: number | null): number | null {
  const lower = message.toLowerCase();

  const numeric =
    lower.match(/\b(?:semester|sem)\s*[-#]?\s*(\d{1,2})\b/) ?? lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:semester|sem)\b/);
  if (numeric) {
    const n = parseInt(numeric[1], 10);
    if (n >= 1 && n <= 12) return n; // sane upper bound — no real program runs more than ~12 semesters
  }

  for (const [word, n] of Object.entries(SEMESTER_ORDINAL_WORDS)) {
    const pattern = new RegExp(`\\b${word}\\s+(?:semester|sem)\\b|\\b(?:semester|sem)\\s+${word}\\b`, 'i');
    if (pattern.test(lower)) return n;
  }

  if (currentSemester != null && currentSemester > 1 && RELATIVE_PREVIOUS_SEMESTER_PATTERN.test(lower)) {
    return currentSemester - 1;
  }

  return null;
}
