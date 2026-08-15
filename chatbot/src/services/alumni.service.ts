import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

const LIST_LIMIT = 15;

/**
 * alumni_network_search — any role: real alumni_members rows. If the
 * message names a company (a simple substring check against
 * current_company), scopes to that; otherwise lists the most recent
 * alumni across every batch.
 */
export async function searchAlumniNetwork({ message }: HandlerContext): Promise<ChatReply> {
  const lower = message.toLowerCase();
  const companies = await prisma.alumni_members.findMany({
    where: { current_company: { not: null } },
    distinct: ['current_company'],
    select: { current_company: true },
  });
  const namedCompany = companies.find((c) => c.current_company && lower.includes(c.current_company.toLowerCase()))?.current_company;

  const alumni = await prisma.alumni_members.findMany({
    where: { status: 'active', ...(namedCompany && { current_company: namedCompany }) },
    take: LIST_LIMIT,
    orderBy: { joined_at: 'desc' },
    select: {
      current_company: true,
      designation: true,
      alumni_batches: { select: { group_name: true, graduated_on: true } },
      students: { select: { soa_applications: { select: { first_name: true, last_name: true } }, student_id_no: true } },
    },
  });

  if (alumni.length === 0) {
    const scope = namedCompany ? ` at ${namedCompany}` : '';
    return { reply: `No alumni found${scope}.`, intent: 'alumni_network_search', confidence: 1 };
  }

  const table = markdownTable(
    ['Name', 'Batch', 'Company', 'Designation'],
    alumni.map((a) => [
      [a.students.soa_applications?.first_name, a.students.soa_applications?.last_name].filter(Boolean).join(' ') || a.students.student_id_no,
      a.alumni_batches.group_name,
      a.current_company ?? 'N/A',
      a.designation ?? 'N/A',
    ]),
  );

  const scope = namedCompany ? ` at ${namedCompany}` : '';
  return { reply: `Alumni${scope} (showing up to ${LIST_LIMIT}):\n\n${table}`, intent: 'alumni_network_search', confidence: 1, data: alumni };
}

/**
 * get_result_publication_status — student (own) / admin (any student,
 * looked up). Uses exams.status (the same 'results_published' signal
 * marks.service.ts already relies on) for the target student's class,
 * rather than result_publications directly — that table logs WHEN/what-type
 * a result was published, but exams.status is the actual visibility gate
 * already enforced elsewhere in this codebase.
 */
export async function getResultPublicationStatus({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_result_publication_status', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their result publication status', 'get_result_publication_status'), intent: 'get_result_publication_status', confidence: 1 };
  if (!target.class_id) {
    return { reply: `${target.name} hasn't been assigned to a class yet.`, intent: 'get_result_publication_status', confidence: 1 };
  }

  const mappings = await prisma.exam_subject_mapping.findMany({
    where: { class_id: target.class_id },
    distinct: ['exam_id'],
    select: { exams: { select: { status: true, academic_year: true, exam_types: { select: { name: true } } } } },
    orderBy: { exam_id: 'desc' },
    take: 10,
  });

  const who = possessive(user, target);
  if (mappings.length === 0) {
    return { reply: `No exams are on record for ${who.toLowerCase() === 'your' ? 'your' : `${target.name}'s`} class.`, intent: 'get_result_publication_status', confidence: 1 };
  }

  const table = markdownTable(
    ['Exam', 'Year', 'Status'],
    mappings.map((m) => [m.exams.exam_types.name, m.exams.academic_year, m.exams.status === 'results_published' ? 'Published' : 'Not yet published']),
  );
  return { reply: `${who} exam result status:\n\n${table}`, intent: 'get_result_publication_status', confidence: 1, data: mappings };
}

/** view_department_achievements — any role: real department_achievements rows for the caller's own department (student/faculty), or overall recent ones for admin. */
export async function viewDepartmentAchievements({ user }: HandlerContext): Promise<ChatReply> {
  const [student, faculty] = await Promise.all([
    prisma.students.findUnique({ where: { user_id: user.sub }, select: { classes: { select: { department_id: true } } } }),
    prisma.faculty.findUnique({ where: { user_id: user.sub }, select: { department_id: true } }),
  ]);
  const departmentId = student?.classes?.department_id ?? faculty?.department_id;

  const achievements = await prisma.department_achievements.findMany({
    where: departmentId ? { department_id: departmentId } : undefined,
    orderBy: { created_at: 'desc' },
    take: LIST_LIMIT,
    select: { title: true, achievement_date: true, departments: { select: { name: true } } },
  });

  if (achievements.length === 0) {
    return { reply: 'No department achievements are on record yet.', intent: 'view_department_achievements', confidence: 1 };
  }

  const table = markdownTable(
    ['Title', 'Department', 'Date'],
    achievements.map((a) => [a.title, a.departments.name, a.achievement_date ? a.achievement_date.toISOString().slice(0, 10) : '—']),
  );
  return { reply: `Department achievements:\n\n${table}`, intent: 'view_department_achievements', confidence: 1, data: achievements };
}
