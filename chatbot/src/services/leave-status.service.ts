import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive, subjectPronoun } from './student-lookup.util';
import { toDateOnly, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/** Inclusive day count — a leave from the 14th to the 14th is 1 day, not 0. */
function daysTaken(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;
}

function formatLeaveStatus(status: string): string {
  switch (status) {
    case 'hod_approved':
      return 'Approved (HOD)';
    case 'faculty_approved':
      return 'Approved (Faculty)';
    case 'pending':
      return 'Pending';
    case 'rejected':
      return 'Rejected';
    default:
      return status;
  }
}

/**
 * get_leave_status — student (own) / admin (any student, looked up by
 * name/ID). student_leaves tracks individual applications (from/to date,
 * approval trail) — there's no leave-quota/allowance concept anywhere in
 * the schema, so "how many leaves can I take MORE" genuinely can't be
 * answered with a real number. Showing the actual application history
 * (with a quick approved/pending/rejected tally) is the honest answer this
 * data actually supports, rather than fabricating an allowance that isn't
 * tracked anywhere.
 */
export async function getLeaveStatus({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_leave_status', confidence: 1 };
  }

  if (!target) {
    return { reply: notFoundReply(user, result, 'their leave status', 'get_leave_status'), intent: 'get_leave_status', confidence: 1 };
  }

  const applications = await prisma.student_leaves.findMany({
    where: { student_id: target.id },
    orderBy: { created_at: 'desc' },
    select: { from_date: true, to_date: true, status: true, reason: true },
  });

  const who = possessive(user, target);

  if (applications.length === 0) {
    return { reply: `${who} hasn't filed any leave applications.`, intent: 'get_leave_status', confidence: 1 };
  }

  const approvedApps = applications.filter((a) => a.status === 'hod_approved' || a.status === 'faculty_approved');
  const pending = applications.filter((a) => a.status === 'pending').length;
  const rejected = applications.filter((a) => a.status === 'rejected').length;
  const totalDaysTaken = approvedApps.reduce((sum, a) => sum + daysTaken(a.from_date, a.to_date), 0);

  const table = markdownTable(
    ['From', 'To', 'Status', 'Reason'],
    applications.map((a) => [toDateOnly(a.from_date), toDateOnly(a.to_date), formatLeaveStatus(a.status), a.reason ?? '—']),
  );

  // Leads with the direct answer to "how many days CAN I take" — there's no
  // maximum/allowance stored anywhere in this schema for student leave (no
  // policy table of any kind, checked explicitly), so the honest answer to
  // that specific question is "I don't have a cap on record", not silence
  // followed by an unrelated table. What IS real and calculable is how many
  // days have actually been taken so far — leads with that instead.
  const summary = `${approvedApps.length} approved, ${pending} pending, ${rejected} rejected`;
  const reply =
    `${subjectPronoun(user)} have taken ${totalDaysTaken} day(s) of approved leave so far (${approvedApps.length} application(s)).\n` +
    `There's no maximum leave-day allowance recorded in this system for students — that limit would be set by your department/HOD directly, ` +
    `not tracked here. Check with your class advisor or HOD for the actual policy.\n\n` +
    `${who} leave history (${summary}):\n\n${table}`;

  return { reply, intent: 'get_leave_status', confidence: 1, data: { applications, totalDaysTaken } };
}
