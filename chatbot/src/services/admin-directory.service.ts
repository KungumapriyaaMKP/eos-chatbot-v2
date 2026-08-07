import { prisma } from '../utils/prisma';
import { fuzzyFindBest } from '../utils/fuzzy';
import type { ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

const LIST_LIMIT = 15;

async function matchDepartment(message: string): Promise<{ id: number; name: string; code: string } | null> {
  const lower = message.toLowerCase();
  const departments = await prisma.departments.findMany({ select: { id: true, name: true, code: true } });

  const exact =
    departments.find((d) => new RegExp(`\\b${d.code.toLowerCase()}\\b`).test(lower)) ??
    departments.find((d) => lower.includes(d.name.toLowerCase()));
  if (exact) return exact;

  return fuzzyFindBest(message, departments, (d) => ({ codes: [d.code], name: d.name }));
}

/** admin_list_students — admin only: list students, optionally filtered by department. */
export async function adminListStudents({ message }: HandlerContext): Promise<ChatReply> {
  const department = await matchDepartment(message);
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

/** admin_list_faculty — admin only: list faculty, optionally filtered by department. */
export async function adminListFaculty({ message }: HandlerContext): Promise<ChatReply> {
  const department = await matchDepartment(message);
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
