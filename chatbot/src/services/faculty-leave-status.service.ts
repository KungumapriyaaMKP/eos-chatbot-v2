import { prisma } from '../utils/prisma';
import { resolveOwnFaculty } from './faculty-lookup.util';
import { toDateOnly, markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * faculty_leave_status — faculty only, always their own applications (no
 * admin/coe free-text lookup, matching the dataset's own role list).
 * faculty_leaves has a two-stage approval trail (hod_approval_status,
 * hr_approval_status) — distinct from student_leaves' single-stage
 * hod/faculty split — so this can't just reuse leave-status.service.ts.
 *
 * Wired up specifically to back the role-aware sibling routing in
 * chat.controller.ts: "check my leave application" is textually identical
 * whether a student or a faculty member says it, so classification alone
 * can land on either intent — RBAC used to just deny the "wrong" one
 * outright. Now that both get_leave_status and this have real handlers, a
 * misclassification between this specific pair costs nothing: whichever
 * one the caller's actual role owns still returns their real data.
 */
export async function getFacultyLeaveStatus({ user }: HandlerContext): Promise<ChatReply> {
  const faculty = await resolveOwnFaculty(user.sub);
  if (!faculty) {
    return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_leave_status', confidence: 1 };
  }

  const applications = await prisma.faculty_leaves.findMany({
    where: { faculty_id: faculty.id },
    orderBy: { created_at: 'desc' },
    select: { from_date: true, to_date: true, hod_approval_status: true, hr_approval_status: true, reason: true },
  });

  if (applications.length === 0) {
    return { reply: "You haven't filed any leave applications.", intent: 'faculty_leave_status', confidence: 1 };
  }

  const fullyApproved = applications.filter((a) => a.hod_approval_status === 'approved' && a.hr_approval_status === 'approved').length;
  const rejected = applications.filter((a) => a.hod_approval_status === 'rejected' || a.hr_approval_status === 'rejected').length;
  const pending = applications.length - fullyApproved - rejected;

  const table = markdownTable(
    ['From', 'To', 'HOD', 'HR', 'Reason'],
    applications.map((a) => [
      toDateOnly(a.from_date),
      toDateOnly(a.to_date),
      capitalize(a.hod_approval_status),
      capitalize(a.hr_approval_status),
      a.reason ?? '—',
    ]),
  );

  const summary = `${fullyApproved} fully approved, ${pending} pending, ${rejected} rejected`;
  return {
    reply: `Your leave applications (${summary}):\n\n${table}`,
    intent: 'faculty_leave_status',
    confidence: 1,
    data: applications,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
