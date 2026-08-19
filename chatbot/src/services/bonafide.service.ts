import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive, subjectPronoun } from './student-lookup.util';
import { toDateOnly, endSentence, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

function formatStatus(status: string): string {
  switch (status) {
    case 'issued':
      return 'Issued';
    case 'rejected':
      return 'Rejected';
    case 'faculty_approved':
      return 'Approved by faculty — awaiting issuance';
    default:
      return 'Pending';
  }
}

/** get_bonafide_status — student (own) / admin (any student, looked up). Real bonafide_requests rows. */
export async function getBonafideStatus({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_bonafide_status', confidence: 1 };
  }
  if (!target) {
    return { reply: notFoundReply(user, result, 'their bonafide certificate status', 'get_bonafide_status'), intent: 'get_bonafide_status', confidence: 1 };
  }

  const requests = await prisma.bonafide_requests.findMany({
    where: { student_id: target.id },
    orderBy: { requested_at: 'desc' },
    select: { status: true, requested_at: true, issued_at: true, bonafide_reasons: { select: { reason_text: true } } },
  });

  const who = possessive(user, target);

  if (requests.length === 0) {
    // subjectPronoun, not possessive -- "hasn't" needs a subject pronoun
    // ("You haven't requested"), not a possessive adjective (the same
    // "Your hasn't ..." bug found live in leave-status/placement/od).
    return { reply: `${subjectPronoun(user)} haven't requested a bonafide certificate.`, intent: 'get_bonafide_status', confidence: 1 };
  }

  const latest = requests[0];
  const reply =
    `${who} most recent bonafide request (${latest.bonafide_reasons.reason_text}), requested ${toDateOnly(latest.requested_at)}: ${formatStatus(latest.status)}` +
    (latest.status === 'issued' && latest.issued_at ? `, issued ${toDateOnly(latest.issued_at)}.` : '.');

  return { reply: endSentence(reply), intent: 'get_bonafide_status', confidence: 1, data: requests };
}
