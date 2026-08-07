import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { toDateOnly, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_profile — student/faculty/admin, always self-scoped (student_id /
 * faculty_id / user_id resolved from the JWT, exactly like EOS-backend's
 * own GET /me/profile and GET /auth/me).
 */
export async function getProfile({ user }: HandlerContext): Promise<ChatReply> {
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
        classes: { select: { section: true } },
        soa_applications: { select: { first_name: true, last_name: true } },
      },
    });

    if (!student) {
      return { reply: "I couldn't find a student profile linked to your account.", intent: 'get_profile', confidence: 1 };
    }

    const name = [student.soa_applications?.first_name, student.soa_applications?.last_name]
      .filter(Boolean)
      .join(' ');
    const section = student.classes ? `, Section ${student.classes.section}` : '';

    const reply =
      `You're ${name || 'a registered student'}, studying ${student.courses.name} in ${student.batches.name}${section}.\n` +
      `Roll No: ${student.roll_no ?? 'N/A'}, Student ID: ${student.student_id_no}` +
      `${student.register_no ? `, Register No: ${student.register_no}` : ''}.`;

    return { reply, intent: 'get_profile', confidence: 1, data: student };
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

    const reply =
      `You're ${faculty.first_name} ${faculty.last_name}, ${faculty.designation} in the ` +
      `${faculty.departments.name} department (${faculty.departments.code}).` +
      (faculty.date_of_joining ? ` You joined on ${toDateOnly(faculty.date_of_joining)}.` : '');

    return { reply, intent: 'get_profile', confidence: 1, data: faculty };
  }

  // Admin (and any other staff role that reaches here): no faculty/student
  // row to describe — just confirm identity from the users/roles tables.
  const account = await prisma.users.findUnique({
    where: { id: user.sub },
    select: { email: true, roles: { select: { name: true, description: true } } },
  });

  return {
    reply: `You're signed in as ${user.name}, ${account?.roles.name ?? user.role} (${account?.email ?? user.email}).`,
    intent: 'get_profile',
    confidence: 1,
    data: account,
  };
}
