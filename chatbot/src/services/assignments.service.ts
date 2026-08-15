import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveOwnFaculty } from './faculty-lookup.util';
import { markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_assignments — student (own class's assignments + their own
 * submission status) / faculty (assignments they've set for their classes +
 * how many students have submitted each one).
 *
 * Real assignments + student_assignment_status rows — this intent didn't
 * exist in the training dataset at all before this (see
 * scripts/add-assignments-intent.ts); those tables sat completely unused
 * despite real data in them.
 */
export async function getAssignments({ user }: HandlerContext): Promise<ChatReply> {
  if (user.role === ROLES.FACULTY) {
    return facultyAssignments(user.sub);
  }
  return studentAssignments(user.sub);
}

async function studentAssignments(userId: number): Promise<ChatReply> {
  const student = await prisma.students.findUnique({ where: { user_id: userId }, select: { id: true, class_id: true } });
  if (!student) {
    return { reply: "I couldn't find a student profile linked to your account.", intent: 'get_assignments', confidence: 1 };
  }
  if (!student.class_id) {
    return { reply: "You haven't been assigned to a class yet, so there are no assignments to show.", intent: 'get_assignments', confidence: 1 };
  }

  const assignments = await prisma.assignments.findMany({
    where: { class_id: student.class_id },
    orderBy: [{ semester: 'desc' }, { sequence_no: 'asc' }],
    select: {
      id: true,
      title: true,
      sequence_no: true,
      semester: true,
      subjects: { select: { name: true } },
      student_assignment_status: { where: { student_id: student.id }, select: { is_submitted: true } },
    },
  });

  if (assignments.length === 0) {
    return { reply: 'No assignments have been posted for your class yet.', intent: 'get_assignments', confidence: 1 };
  }

  const table = markdownTable(
    ['Subject', 'Assignment', 'Status'],
    assignments.map((a) => [
      a.subjects.name,
      a.title ?? `#${a.sequence_no}`,
      a.student_assignment_status[0]?.is_submitted ? 'Submitted' : 'Not submitted',
    ]),
  );

  const pending = assignments.filter((a) => !a.student_assignment_status[0]?.is_submitted).length;
  return {
    reply: `Your assignments (${pending} not yet submitted):\n\n${table}`,
    intent: 'get_assignments',
    confidence: 1,
    data: assignments,
  };
}

async function facultyAssignments(userId: number): Promise<ChatReply> {
  const faculty = await resolveOwnFaculty(userId);
  if (!faculty) {
    return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'get_assignments', confidence: 1 };
  }

  const assignments = await prisma.assignments.findMany({
    where: { faculty_id: faculty.id },
    orderBy: [{ semester: 'desc' }, { sequence_no: 'asc' }],
    take: 15,
    select: {
      title: true,
      sequence_no: true,
      subjects: { select: { name: true } },
      classes: { select: { section: true, departments: { select: { code: true } } } },
      student_assignment_status: { select: { is_submitted: true } },
    },
  });

  if (assignments.length === 0) {
    return { reply: "You haven't set any assignments yet.", intent: 'get_assignments', confidence: 1 };
  }

  const table = markdownTable(
    ['Class', 'Subject', 'Assignment', 'Submitted'],
    assignments.map((a) => {
      const submitted = a.student_assignment_status.filter((s) => s.is_submitted).length;
      const total = a.student_assignment_status.length;
      return [
        `${a.classes.departments.code}-${a.classes.section}`,
        a.subjects.name,
        a.title ?? `#${a.sequence_no}`,
        `${submitted}/${total}`,
      ];
    }),
  );

  return { reply: `Your assignments:\n\n${table}`, intent: 'get_assignments', confidence: 1, data: assignments };
}
