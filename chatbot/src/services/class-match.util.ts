import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { fuzzyFindBest } from '../utils/fuzzy';
import type { JwtPayload } from '../auth/jwt-payload.interface';

export interface CandidateClass {
  id: number;
  section: string;
  departmentCode: string;
  label: string; // e.g. "CSE-A"
}

async function facultyAssignedClasses(facultyId: number): Promise<CandidateClass[]> {
  const [subjectMappings, mentorMappings] = await Promise.all([
    prisma.faculty_subject_class_mapping.findMany({ where: { faculty_id: facultyId }, select: { class_id: true } }),
    prisma.class_mentors.findMany({ where: { faculty_id: facultyId }, select: { class_id: true } }),
  ]);
  const classIds = [...new Set([...subjectMappings, ...mentorMappings].map((m) => m.class_id))];
  if (classIds.length === 0) return [];

  const classes = await prisma.classes.findMany({
    where: { id: { in: classIds } },
    select: { id: true, section: true, departments: { select: { code: true } } },
  });

  return classes.map((c) => ({
    id: c.id,
    section: c.section,
    departmentCode: c.departments.code,
    label: `${c.departments.code}-${c.section}`,
  }));
}

async function allClasses(): Promise<CandidateClass[]> {
  const classes = await prisma.classes.findMany({
    select: { id: true, section: true, departments: { select: { code: true } } },
  });
  return classes.map((c) => ({
    id: c.id,
    section: c.section,
    departmentCode: c.departments.code,
    label: `${c.departments.code}-${c.section}`,
  }));
}

/**
 * Resolves "which class" a faculty/admin message is about.
 *  - faculty → only ever their own assigned classes (subject mappings + mentorships)
 *  - admin   → any class in the institution
 * If exactly one candidate exists (e.g. a faculty mentoring a single class),
 * it's used automatically. Otherwise the message is scanned for a
 * "DEPT-SECTION" or bare section token — exact first, then fuzzy (typo'd
 * section codes, e.g. "csea" or "cse-a1"); if nothing matches, `match` is
 * null and the caller should list `candidates` and ask the user to pick one.
 */
export async function resolveTargetClass(
  user: JwtPayload,
  message: string,
): Promise<{ match: CandidateClass | null; candidates: CandidateClass[] }> {
  const candidates =
    user.role === ROLES.FACULTY
      ? await facultyAssignedClasses(user.sub)
      : user.role === ROLES.ADMIN
        ? await allClasses()
        : [];

  if (candidates.length === 1) {
    return { match: candidates[0], candidates };
  }

  const lower = message.toLowerCase();
  const bySection = new Map<string, CandidateClass[]>();
  for (const c of candidates) {
    if (lower.includes(c.label.toLowerCase())) {
      return { match: c, candidates };
    }
    const key = c.section.toLowerCase();
    bySection.set(key, [...(bySection.get(key) ?? []), c]);
  }

  for (const [section, list] of bySection) {
    if (list.length === 1 && new RegExp(`\\b${section}\\b`, 'i').test(message)) {
      return { match: list[0], candidates };
    }
  }

  const fuzzy = fuzzyFindBest(message, candidates, (c) => ({ codes: [c.label, c.section] }));
  if (fuzzy) return { match: fuzzy, candidates };

  return { match: null, candidates };
}
