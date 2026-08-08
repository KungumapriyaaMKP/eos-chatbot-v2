import { prisma } from '../utils/prisma';
import { fuzzyFindBest } from '../utils/fuzzy';

export interface ResolvedFaculty {
  id: number;
  name: string;
  department_id: number;
}

/** A faculty member's own record, resolved from their JWT — never from the chat message. */
export async function resolveOwnFaculty(userId: number): Promise<ResolvedFaculty | null> {
  const row = await prisma.faculty.findUnique({
    where: { user_id: userId },
    select: { id: true, first_name: true, last_name: true, department_id: true },
  });
  if (!row) return null;
  return { id: row.id, name: `${row.first_name} ${row.last_name}`.trim(), department_id: row.department_id };
}

/**
 * Admin/hod lookup-by-name — the faculty-side counterpart to
 * student-lookup.util.ts's resolveStudentByFreeText. Faculty have no
 * ID-shaped identifier the way students do (student_id_no/roll_no/register_no),
 * just first_name/last_name, so this is fuzzy name matching only, no exact-ID
 * fast path. `departmentId` scopes the candidate pool for hod (their real
 * authority boundary elsewhere in this codebase — see class-match.util.ts's
 * hodDepartmentClasses); omit it for admin, who can look up any department.
 */
export async function resolveFacultyByFreeText(message: string, departmentId?: number): Promise<ResolvedFaculty | null> {
  const pool = await prisma.faculty.findMany({
    where: { status: 'active', ...(departmentId !== undefined && { department_id: departmentId }) },
    select: { id: true, first_name: true, last_name: true, department_id: true },
  });

  const match = fuzzyFindBest(message, pool, (row) => ({ name: `${row.first_name} ${row.last_name}`.trim() }));
  if (!match) return null;

  return { id: match.id, name: `${match.first_name} ${match.last_name}`.trim(), department_id: match.department_id };
}
