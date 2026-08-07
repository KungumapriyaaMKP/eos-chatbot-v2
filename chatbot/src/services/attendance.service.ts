import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive, subjectPronoun } from './student-lookup.util';
import { matchSubjectInMessage } from './subject-match.util';
import { round2, endSentence, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_attendance — student (own) / parent (own child) / admin (any
 * student, looked up by name, ID, roll, or register number, fuzzy-matched).
 * Same aggregation EOS-backend's MeAttendanceService does (present/absent
 * counts → percentage, overall and per-subject), read directly off
 * attendance_records since there's no admin-facing "attendance for student
 * X" REST endpoint yet.
 */
export async function getAttendance({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_attendance', confidence: 1 };
  }

  if (!target) {
    return { reply: notFoundReply(user, result, 'their attendance', 'get_attendance'), intent: 'get_attendance', confidence: 1 };
  }

  const subject = await matchSubjectInMessage(message);

  const records = await prisma.attendance_records.findMany({
    where: { student_id: target.id, ...(subject && { subject_id: subject.id }) },
    select: { status: true },
  });

  const total = records.length;
  const present = records.filter((r) => r.status === 'present').length;

  if (total === 0) {
    const scope = subject ? ` for ${subject.name}` : '';
    return {
      reply: endSentence(`I don't see any attendance records${scope} for ${target.name}`),
      intent: 'get_attendance',
      confidence: 1,
    };
  }

  const percentage = round2((present / total) * 100);
  const who = possessive(user, target);
  const scope = subject ? ` in ${subject.name}` : ' overall';

  const reply =
    `${who} current attendance${scope} is ${percentage}%. ` +
    `${subjectPronoun(user)} have attended ${present} out of ${total} classes.`;

  return {
    reply,
    intent: 'get_attendance',
    confidence: 1,
    data: { student_id: target.id, subject: subject?.name ?? null, total, present, percentage },
  };
}
