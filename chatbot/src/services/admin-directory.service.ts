import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { fuzzyFindBest } from '../utils/fuzzy';
import type { ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

const LIST_LIMIT = 15;

type Department = { id: number; name: string; code: string };

async function matchDepartment(message: string): Promise<Department | null> {
  const lower = message.toLowerCase();
  const departments = await prisma.departments.findMany({ select: { id: true, name: true, code: true } });

  const exact =
    departments.find((d) => new RegExp(`\\b${d.code.toLowerCase()}\\b`).test(lower)) ??
    departments.find((d) => lower.includes(d.name.toLowerCase()));
  if (exact) return exact;

  return fuzzyFindBest(message, departments, (d) => ({ codes: [d.code], name: d.name }));
}

/**
 * Resolves which department to scope a directory listing to.
 *  - hod   → ALWAYS their own department, regardless of what (if anything)
 *    the message mentions — an HOD's authority doesn't extend past their
 *    own department, so overriding rather than merely defaulting is the
 *    correct enforcement here, not just a convenience.
 *  - admin → whatever department the message names, or none (see everyone)
 */
async function resolveDepartmentScope(user: HandlerContext['user'], message: string): Promise<Department | null> {
  if (user.role === ROLES.HOD) {
    const faculty = await prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { departments: { select: { id: true, name: true, code: true } } },
    });
    return faculty?.departments ?? null;
  }
  return matchDepartment(message);
}

/** admin_list_students — admin (any department) / hod (their own department only). */
export async function adminListStudents({ user, message }: HandlerContext): Promise<ChatReply> {
  const department = await resolveDepartmentScope(user, message);
  const scope = department ? ` in ${department.name}` : '';

  const [total, rows] = await Promise.all([
    prisma.students.count({
      where: department ? { classes: { department_id: department.id } } : undefined,
    }),
    prisma.students.findMany({
      where: department ? { classes: { department_id: department.id } } : undefined,
      take: LIST_LIMIT,
      select: { student_id_no: true, roll_no: true, soa_applications: { select: { first_name: true, last_name: true } } },
      orderBy: { id: 'asc' },
    }),
  ]);

  if (total === 0) {
    return { reply: `I couldn't find any students${scope}.`, intent: 'admin_list_students', confidence: 1 };
  }

  const lines = rows.map((s) => {
    const name = [s.soa_applications?.first_name, s.soa_applications?.last_name].filter(Boolean).join(' ');
    return `• ${s.roll_no ?? s.student_id_no}: ${name || s.student_id_no}`;
  });

  const more = total > rows.length ? `\n\n...and ${total - rows.length} more.` : '';

  return {
    reply: `${total} student(s)${scope}. Showing the first ${rows.length}:\n\n${lines.join('\n')}${more}`,
    intent: 'admin_list_students',
    confidence: 1,
    data: { total, rows },
  };
}

/** admin_list_faculty — admin (any department) / hod (their own department only). */
export async function adminListFaculty({ user, message }: HandlerContext): Promise<ChatReply> {
  const department = await resolveDepartmentScope(user, message);
  const scope = department ? ` in ${department.name}` : '';

  const [total, rows] = await Promise.all([
    prisma.faculty.count({ where: department ? { department_id: department.id } : undefined }),
    prisma.faculty.findMany({
      where: department ? { department_id: department.id } : undefined,
      take: LIST_LIMIT,
      select: { first_name: true, last_name: true, designation: true, departments: { select: { code: true } } },
      orderBy: { id: 'asc' },
    }),
  ]);

  if (total === 0) {
    return { reply: `I couldn't find any faculty${scope}.`, intent: 'admin_list_faculty', confidence: 1 };
  }

  const lines = rows.map((f) => `• ${f.first_name} ${f.last_name}: ${f.designation} (${f.departments.code})`);
  const more = total > rows.length ? `\n\n...and ${total - rows.length} more.` : '';

  return {
    reply: `${total} faculty member(s)${scope}. Showing the first ${rows.length}:\n\n${lines.join('\n')}${more}`,
    intent: 'admin_list_faculty',
    confidence: 1,
    data: { total, rows },
  };
}
