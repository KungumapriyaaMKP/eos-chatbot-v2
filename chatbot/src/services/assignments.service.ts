import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveOwnFaculty } from './faculty-lookup.util';
import { markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * Real bug found via live screenshot: "pending assignments" returned every
 * assignment (submitted and not), not just the pending ones — the header
 * line correctly SAID "(3 not yet submitted)" but the table below ignored
 * the message entirely and showed everything regardless. getAssignments
 * didn't even read `message` before this fix.
 */
const PENDING_PATTERN = /\b(pending|not\s*submit|un\s*submit|outstanding|incomplete|remaining|due|yet to submit)\b/i;
const SUBMITTED_PATTERN = /\b(submitted|completed|done|finished|turned in)\b/i;

/**
 * get_assignments — student (own class's assignments + their own
 * submission status, optionally filtered to just pending or just submitted
 * ones) / faculty (assignments they've set for their classes + how many
 * students have submitted each one).
 *
 * Real assignments + student_assignment_status rows — this intent didn't
 * exist in the training dataset at all before this (see
 * scripts/add-assignments-intent.ts); those tables sat completely unused
 * despite real data in them.
 */
export async function getAssignments({ user, message }: HandlerContext): Promise<ChatReply> {
  if (user.role === ROLES.FACULTY) {
    return facultyAssignments(user.sub);
  }
  return studentAssignments(user.sub, message);
}

async function studentAssignments(userId: number, message: string): Promise<ChatReply> {
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

  const pending = assignments.filter((a) => !a.student_assignment_status[0]?.is_submitted).length;

  // "pending assignments" / "submitted assignments" filters the actual
  // list, not just the summary count in the header — a real bug found live
  // where the header correctly said "(3 not yet submitted)" but the table
  // below it showed every assignment regardless of what was asked.
  const wantsPending = PENDING_PATTERN.test(message);
  const wantsSubmitted = !wantsPending && SUBMITTED_PATTERN.test(message);
  const filtered = wantsPending
    ? assignments.filter((a) => !a.student_assignment_status[0]?.is_submitted)
    : wantsSubmitted
      ? assignments.filter((a) => a.student_assignment_status[0]?.is_submitted)
      : assignments;

  if (filtered.length === 0) {
    const scope = wantsPending ? 'pending' : 'submitted';
    return { reply: `You have no ${scope} assignments right now.`, intent: 'get_assignments', confidence: 1, data: [] };
  }

  const table = markdownTable(
    ['Subject', 'Assignment', 'Status'],
    filtered.map((a) => [
      a.subjects.name,
      a.title ?? `#${a.sequence_no}`,
      a.student_assignment_status[0]?.is_submitted ? 'Submitted' : 'Not submitted',
    ]),
  );

  const heading = wantsPending
    ? `Your pending assignments (${filtered.length}):`
    : wantsSubmitted
      ? `Your submitted assignments (${filtered.length}):`
      : `Your assignments (${pending} not yet submitted):`;

  return {
    reply: `${heading}\n\n${table}`,
    intent: 'get_assignments',
    confidence: 1,
    data: filtered,
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
