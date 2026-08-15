import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { formatCurrency, toDateOnly, endSentence, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/** get_hostel_room — student (own) / admin (any student, looked up). Real student_hostel_mapping row. */
export async function getHostelRoom({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_hostel_room', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their hostel room', 'get_hostel_room'), intent: 'get_hostel_room', confidence: 1 };

  const mapping = await prisma.student_hostel_mapping.findUnique({
    where: { student_id: target.id },
    select: { allocated_date: true, hostel_rooms: { select: { room_number: true, capacity: true, hostel_room_types: { select: { name: true } } } } },
  });

  const who = possessive(user, target);
  if (!mapping) {
    return { reply: endSentence(`${who} account isn't allocated a hostel room`), intent: 'get_hostel_room', confidence: 1 };
  }

  return {
    reply: `${who} hostel room: ${mapping.hostel_rooms.room_number} (${mapping.hostel_rooms.hostel_room_types.name}, capacity ${mapping.hostel_rooms.capacity}), allocated ${toDateOnly(mapping.allocated_date)}.`,
    intent: 'get_hostel_room',
    confidence: 1,
    data: mapping,
  };
}

/** get_hostel_ledger — student (own) / admin (any student, looked up). The hostel fee structure and any payments made against it (fee_payments has no hostel-specific tag, so this reports the fee_structure tied to their room allocation). */
export async function getHostelLedger({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_hostel_ledger', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their hostel ledger', 'get_hostel_ledger'), intent: 'get_hostel_ledger', confidence: 1 };

  const mapping = await prisma.student_hostel_mapping.findUnique({
    where: { student_id: target.id },
    select: { fee_structures: { select: { name: true, academic_year: true, fee_structure_items: { select: { amount: true } } } } },
  });

  const who = possessive(user, target);
  if (!mapping || !mapping.fee_structures) {
    return { reply: endSentence(`${who} account has no hostel fee structure on record`), intent: 'get_hostel_ledger', confidence: 1 };
  }

  const total = mapping.fee_structures.fee_structure_items.reduce((sum, i) => sum + Number(i.amount), 0);
  return {
    reply: `${who} hostel fee structure: ${mapping.fee_structures.name} (${mapping.fee_structures.academic_year}), total ${formatCurrency(total)}.`,
    intent: 'get_hostel_ledger',
    confidence: 1,
    data: mapping,
  };
}

function formatOutingStatus(status: string): string {
  return status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending';
}

/** get_outing_status — student (own) / admin (any student, looked up). Real hostel_outings rows. */
export async function getOutingStatus({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_outing_status', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their outing status', 'get_outing_status'), intent: 'get_outing_status', confidence: 1 };

  const outings = await prisma.hostel_outings.findMany({
    where: { student_id: target.id },
    orderBy: { created_at: 'desc' },
    take: 5,
    select: { from_date: true, to_date: true, status: true, reason: true },
  });

  const who = possessive(user, target);
  if (outings.length === 0) {
    return { reply: `${who} hasn't requested a hostel outing.`, intent: 'get_outing_status', confidence: 1 };
  }

  const latest = outings[0];
  return {
    reply: `${who} most recent outing request (${toDateOnly(latest.from_date)} to ${toDateOnly(latest.to_date)}${latest.reason ? `, ${latest.reason}` : ''}): ${formatOutingStatus(latest.status)}.`,
    intent: 'get_outing_status',
    confidence: 1,
    data: outings,
  };
}
