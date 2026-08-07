import { prisma } from '../utils/prisma';
import { fuzzyFindBest } from '../utils/fuzzy';

export interface MatchedSubject {
  id: number;
  name: string;
  subject_code: string;
}

/**
 * Best-effort "did the user mention a specific subject" check — e.g.
 * "attendance in dbms" or "show my attendance for CS402", including typo'd
 * or abbreviated spellings ("atendance in dbsm", "database mgmt"). Tries an
 * exact subject_code token match first (fastest, most reliable), then falls
 * back to fuzzy matching against both subject_code and subject name.
 * Returns null (meaning: "overall", not subject-specific) when nothing
 * matches confidently — a wrong subject match is worse than no subject match.
 */
export async function matchSubjectInMessage(message: string): Promise<MatchedSubject | null> {
  const lower = message.toLowerCase();
  const tokens: string[] = lower.match(/\b[a-z0-9]+\b/g) ?? [];

  const subjects = await prisma.subjects.findMany({
    select: { id: true, name: true, subject_code: true },
  });

  for (const subject of subjects) {
    if (tokens.includes(subject.subject_code.toLowerCase())) {
      return subject;
    }
  }

  return fuzzyFindBest(message, subjects, (s) => ({ codes: [s.subject_code], name: s.name }));
}
