import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { markdownTable, endSentence, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/** get_hall_ticket — student (own) / admin (any student, looked up). Real hall_tickets rows. */
export async function getHallTicket({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_hall_ticket', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their hall ticket', 'get_hall_ticket'), intent: 'get_hall_ticket', confidence: 1 };

  const tickets = await prisma.hall_tickets.findMany({
    where: { student_id: target.id },
    orderBy: { generated_at: 'desc' },
    select: { generated_at: true, exams: { select: { exam_types: { select: { name: true } } } } },
  });

  const who = possessive(user, target);
  if (tickets.length === 0) {
    return { reply: endSentence(`${who} hall ticket hasn't been generated yet`), intent: 'get_hall_ticket', confidence: 1 };
  }

  const table = markdownTable(['Exam'], tickets.map((t) => [t.exams.exam_types.name]));
  return { reply: `${who} hall ticket has been generated for:\n\n${table}`, intent: 'get_hall_ticket', confidence: 1, data: tickets };
}

/** get_exam_seat — student (own) / admin (any student, looked up). Real seating_arrangements rows. */
export async function getExamSeat({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_exam_seat', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their exam seat', 'get_exam_seat'), intent: 'get_exam_seat', confidence: 1 };

  const seats = await prisma.seating_arrangements.findMany({
    where: { student_id: target.id },
    select: {
      seat_number: true,
      hall_plans: { select: { exam_date: true, venues: { select: { name: true } }, exams: { select: { exam_types: { select: { name: true } } } } } },
    },
  });

  const who = possessive(user, target);
  if (seats.length === 0) {
    return { reply: endSentence(`No exam seating has been assigned for ${who.toLowerCase() === 'your' ? 'you' : target.name} yet`), intent: 'get_exam_seat', confidence: 1 };
  }

  const table = markdownTable(
    ['Exam', 'Venue', 'Date', 'Seat'],
    seats.map((s) => [s.hall_plans.exams.exam_types.name, s.hall_plans.venues.name, s.hall_plans.exam_date.toISOString().slice(0, 10), s.seat_number]),
  );
  return { reply: `${who} exam seating:\n\n${table}`, intent: 'get_exam_seat', confidence: 1, data: seats };
}

/** get_marksheet — student (own) / admin (any student, looked up). Real marksheets rows. */
export async function getMarksheet({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_marksheet', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their marksheet', 'get_marksheet'), intent: 'get_marksheet', confidence: 1 };

  const sheets = await prisma.marksheets.findMany({
    where: { student_id: target.id },
    orderBy: { generated_at: 'desc' },
    select: { generated_at: true, exams: { select: { exam_types: { select: { name: true } } } } },
  });

  const who = possessive(user, target);
  if (sheets.length === 0) {
    return { reply: endSentence(`No marksheet has been generated for ${target.name} yet`), intent: 'get_marksheet', confidence: 1 };
  }

  const table = markdownTable(['Exam'], sheets.map((s) => [s.exams.exam_types.name]));
  return { reply: `${who} marksheets are available for:\n\n${table}`, intent: 'get_marksheet', confidence: 1, data: sheets };
}

function formatRevalStatus(status: string): string {
  switch (status) {
    case 'under_review':
      return 'Under review';
    case 'revised':
      return 'Marks revised';
    case 'no_change':
      return 'No change after review';
    default:
      return 'Requested';
  }
}

/** get_revaluation_status — student (own) / admin (any student, looked up). Real revaluation_requests rows. */
export async function getRevaluationStatus({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_revaluation_status', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their revaluation status', 'get_revaluation_status'), intent: 'get_revaluation_status', confidence: 1 };

  const requests = await prisma.revaluation_requests.findMany({
    where: { student_id: target.id },
    orderBy: { requested_at: 'desc' },
    select: { status: true, revised_marks: true, requested_at: true, resolved_at: true },
  });

  const who = possessive(user, target);
  if (requests.length === 0) {
    return { reply: `${who} hasn't requested a revaluation.`, intent: 'get_revaluation_status', confidence: 1 };
  }

  const table = markdownTable(
    ['Requested', 'Status', 'Revised Marks'],
    requests.map((r) => [r.requested_at.toISOString().slice(0, 10), formatRevalStatus(r.status), r.revised_marks?.toString() ?? '—']),
  );
  return { reply: `${who} revaluation requests:\n\n${table}`, intent: 'get_revaluation_status', confidence: 1, data: requests };
}
