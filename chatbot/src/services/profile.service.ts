import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { toDateOnly, markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_profile — student/faculty/admin, always self-scoped (student_id /
 * faculty_id / user_id resolved from the JWT, exactly like EOS-backend's
 * own GET /me/profile and GET /auth/me).
 */
export async function getProfile({ user }: HandlerContext): Promise<ChatReply> {
  // user.name already carries the same soa_applications-first, then
  // faculty-name, then email-local-part fallback that auth.service.ts
  // resolves once at login (resolveDisplayName) — reusing it here instead
  // of re-deriving from soa_applications alone avoids showing a blank
  // "N/A" for the (fairly common, in this seed data) case where a student
  // has no linked soa_applications row at all.
  if (user.role === ROLES.STUDENT) {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
      select: {
        student_id_no: true,
        roll_no: true,
        register_no: true,
        student_type: true,
        date_of_birth: true,
        courses: { select: { name: true } },
        batches: { select: { name: true } },
        classes: { select: { section: true, current_semester: true } },
        soa_applications: { select: { first_name: true, last_name: true } },
      },
    });

    if (!student) {
      return { reply: "I couldn't find a student profile linked to your account.", intent: 'get_profile', confidence: 1 };
    }

    const name =
      [student.soa_applications?.first_name, student.soa_applications?.last_name].filter(Boolean).join(' ') || user.name;

    const table = markdownTable(
      ['Field', 'Value'],
      [
        ['Name', name],
        ['Course', student.courses.name],
        ['Batch', student.batches.name],
        ['Section', student.classes?.section ?? 'N/A'],
        ['Semester', student.classes?.current_semester ?? 'N/A'],
        ['Roll No', student.roll_no ?? 'N/A'],
        ['Student ID', student.student_id_no],
        ['Register No', student.register_no ?? 'N/A'],
      ],
    );

    return { reply: `Your profile:\n\n${table}`, intent: 'get_profile', confidence: 1, data: student };
  }

  if (user.role === ROLES.FACULTY) {
    const faculty = await prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: {
        first_name: true,
        last_name: true,
        designation: true,
        date_of_joining: true,
        departments: { select: { name: true, code: true } },
      },
    });

    if (!faculty) {
      return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'get_profile', confidence: 1 };
    }

    const table = markdownTable(
      ['Field', 'Value'],
      [
        ['Name', `${faculty.first_name} ${faculty.last_name}`],
        ['Designation', faculty.designation],
        ['Department', `${faculty.departments.name} (${faculty.departments.code})`],
        ['Joined On', faculty.date_of_joining ? toDateOnly(faculty.date_of_joining) : 'N/A'],
      ],
    );

    return { reply: `Your profile:\n\n${table}`, intent: 'get_profile', confidence: 1, data: faculty };
  }

  // Admin (and any other staff role that reaches here): no faculty/student
  // row to describe — just confirm identity from the users/roles tables.
  const account = await prisma.users.findUnique({
    where: { id: user.sub },
    select: { email: true, roles: { select: { name: true, description: true } } },
  });

  const table = markdownTable(
    ['Field', 'Value'],
    [
      ['Name', user.name],
      ['Role', account?.roles.name ?? user.role],
      ['Email', account?.email ?? user.email],
    ],
  );

  return {
    reply: `Your profile:\n\n${table}`,
    intent: 'get_profile',
    confidence: 1,
    data: account,
  };
}
