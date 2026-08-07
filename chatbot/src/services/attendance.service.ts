import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveTargetStudent, adminLookupPrompt, NO_LINKED_STUDENT_MESSAGE } from './student-lookup.util';
import { matchSubjectInMessage } from './subject-match.util';
import { round2, endSentence, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_attendance — student (own) / admin (any student, looked up by name,
 * ID, roll, or register number, fuzzy-matched). Same aggregation
 * EOS-backend's MeAttendanceService does (present/absent counts →
 * percentage, overall and per-subject), read directly off
 * attendance_records since there's no admin-facing "attendance for student
 * X" REST endpoint yet.
 */
export async function getAttendance({ user, message }: HandlerContext): Promise<ChatReply> {
  const { student: target, forbidden } = await resolveTargetStudent(user, message);

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_attendance', confidence: 1 };
  }

  if (!target) {
    const reply = user.role === ROLES.ADMIN ? adminLookupPrompt('their attendance') : NO_LINKED_STUDENT_MESSAGE;
    return { reply, intent: 'get_attendance', confidence: 1 };
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
  const isAdmin = user.role === ROLES.ADMIN;
  const who = isAdmin ? `${target.name}'s` : 'Your';
  const scope = subject ? ` in ${subject.name}` : ' overall';

  const reply =
    `${who} current attendance${scope} is ${percentage}%. ` +
    `${isAdmin ? 'They have' : 'You have'} attended ${present} out of ${total} classes.`;

  return {
    reply,
    intent: 'get_attendance',
    confidence: 1,
    data: { student_id: target.id, subject: subject?.name ?? null, total, present, percentage },
  };
}
