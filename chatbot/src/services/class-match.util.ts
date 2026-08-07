import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { fuzzyFindBest } from '../utils/fuzzy';
import { getSessionContext, updateSessionContext } from '../intent/session-context';
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

/** An HOD's authority is department-wide, not limited to classes they personally teach/mentor — every class in their own department, resolved from their own linked faculty record. */
async function hodDepartmentClasses(userId: number): Promise<CandidateClass[]> {
  const faculty = await prisma.faculty.findUnique({ where: { user_id: userId }, select: { department_id: true } });
  if (!faculty) return [];

  const classes = await prisma.classes.findMany({
    where: { department_id: faculty.department_id },
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
 * Resolves "which class" a faculty/hod/admin message is about.
 *  - faculty → only ever their own assigned classes (subject mappings + mentorships)
 *  - hod     → every class in their own department (their real authority
 *    boundary — a class they don't personally teach is still theirs to ask about)
 *  - admin   → any class in the institution
 * If exactly one candidate exists (e.g. a faculty mentoring a single class),
 * it's used automatically. Otherwise the message is scanned for a
 * "DEPT-SECTION" or bare section token — exact first, then fuzzy (typo'd
 * section codes, e.g. "csea" or "cse-a1"). If THIS message doesn't name one
 * either, falls back to whichever class this chat session last resolved
 * (see src/intent/session-context.ts) — e.g. "attendance for CSE-A" then
 * "who's in that class" doesn't need the section repeated. Only when none
 * of that finds anything is `match` null, and the caller should list
 * `candidates` and ask the user to pick one.
 */
export async function resolveTargetClass(
  user: JwtPayload,
  message: string,
): Promise<{ match: CandidateClass | null; candidates: CandidateClass[] }> {
  const candidates =
    user.role === ROLES.FACULTY
      ? await facultyAssignedClasses(user.sub)
      : user.role === ROLES.HOD
        ? await hodDepartmentClasses(user.sub)
        : user.role === ROLES.ADMIN
          ? await allClasses()
          : [];

  const match = findInMessage(message, candidates) ?? (await fallbackToSession(user.sub, candidates));

  if (match) {
    updateSessionContext(user.sub, { lastClassId: match.id });
  }

  return { match, candidates };
}

function findInMessage(message: string, candidates: CandidateClass[]): CandidateClass | null {
  if (candidates.length === 1) {
    return candidates[0];
  }

  const lower = message.toLowerCase();
  const bySection = new Map<string, CandidateClass[]>();
  for (const c of candidates) {
    if (lower.includes(c.label.toLowerCase())) {
      return c;
    }
    const key = c.section.toLowerCase();
    bySection.set(key, [...(bySection.get(key) ?? []), c]);
  }

  for (const [section, list] of bySection) {
    if (list.length === 1 && new RegExp(`\\b${section}\\b`, 'i').test(message)) {
      return list[0];
    }
  }

  return fuzzyFindBest(message, candidates, (c) => ({ codes: [c.label, c.section] }));
}

async function fallbackToSession(userId: number, candidates: CandidateClass[]): Promise<CandidateClass | null> {
  const ctx = getSessionContext(userId);
  if (!ctx?.lastClassId) return null;
  return candidates.find((c) => c.id === ctx.lastClassId) ?? null;
}
