import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { toDateOnly, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

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

  const hodApproved = applications.filter((a) => a.status === 'hod_approved').length;
  const facultyApproved = applications.filter((a) => a.status === 'faculty_approved').length;
  const pending = applications.filter((a) => a.status === 'pending').length;
  const rejected = applications.filter((a) => a.status === 'rejected').length;

  const table = markdownTable(
    ['From', 'To', 'Status', 'Reason'],
    applications.map((a) => [toDateOnly(a.from_date), toDateOnly(a.to_date), formatLeaveStatus(a.status), a.reason ?? '—']),
  );

  const summary = `${hodApproved + facultyApproved} approved, ${pending} pending, ${rejected} rejected`;
  const reply = `${who} leave applications (${summary}):\n\n${table}`;

  return { reply, intent: 'get_leave_status', confidence: 1, data: applications };
}
