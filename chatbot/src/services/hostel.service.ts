import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive, subjectPronoun } from './student-lookup.util';
import { toDateOnly, endSentence, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
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

const LEDGER_LIMIT = 15;

/**
 * get_hostel_ledger — student (own) / admin (any student, looked up). Real
 * gap found live: every training example for this intent (see
 * intents.json) is about hostel-GATE in/out log entries ("did my out
 * entry get recorded", "show my hostel gate entries", "when did I check
 * in yesterday") -- but this handler used to read fee_structures instead,
 * a completely different real-world question that happened to share the
 * word "hostel". A student correctly classified here would have gotten a
 * fee total in reply to "show my hostel gate entries" -- on-topic-sounding
 * but actually answering nothing they asked. Rewritten to read the real
 * table this intent's own name and training data describe:
 * hostel_in_out_ledger (entry_type: in/out, timestamped).
 */
export async function getHostelLedger({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_hostel_ledger', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their hostel in/out log', 'get_hostel_ledger'), intent: 'get_hostel_ledger', confidence: 1 };

  const entries = await prisma.hostel_in_out_ledger.findMany({
    where: { student_id: target.id },
    orderBy: { recorded_at: 'desc' },
    take: LEDGER_LIMIT,
    select: { entry_type: true, recorded_at: true },
  });

  const who = possessive(user, target);
  if (entries.length === 0) {
    return { reply: endSentence(`${who} account has no hostel gate entries on record`), intent: 'get_hostel_ledger', confidence: 1 };
  }

  const table = markdownTable(
    ['Type', 'Time'],
    entries.map((e) => [e.entry_type === 'in' ? 'Check-in' : 'Check-out', e.recorded_at.toISOString().slice(0, 16).replace('T', ' ')]),
  );
  const more = entries.length >= LEDGER_LIMIT ? '\n\n(showing the most recent entries only)' : '';

  return {
    reply: `${who} recent hostel gate entries:\n\n${table}${more}`,
    intent: 'get_hostel_ledger',
    confidence: 1,
    data: entries,
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
    // subjectPronoun, not possessive -- same "Your hasn't ..." grammar bug fix as elsewhere.
    return { reply: `${subjectPronoun(user)} haven't requested a hostel outing.`, intent: 'get_outing_status', confidence: 1 };
  }

  const latest = outings[0];
  return {
    reply: `${who} most recent outing request (${toDateOnly(latest.from_date)} to ${toDateOnly(latest.to_date)}${latest.reason ? `, ${latest.reason}` : ''}): ${formatOutingStatus(latest.status)}.`,
    intent: 'get_outing_status',
    confidence: 1,
    data: outings,
  };
}
