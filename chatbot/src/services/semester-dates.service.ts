import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { toDateOnly, endSentence, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_semester_dates — student (own batch+semester) / admin (any student,
 * looked up) / faculty (no single batch of their own — reports whichever
 * academic_calendars row is active today, across any batch, since a
 * faculty member can teach across multiple batches/semesters at once).
 */
export async function getSemesterDates({ user, message }: HandlerContext): Promise<ChatReply> {
  if (user.role === ROLES.FACULTY) {
    return currentActiveSemester();
  }

  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_semester_dates', confidence: 1 };
  }
  if (!target) {
    return { reply: notFoundReply(user, result, 'their semester dates', 'get_semester_dates'), intent: 'get_semester_dates', confidence: 1 };
  }

  const student = await prisma.students.findUnique({
    where: { id: target.id },
    select: { batch_id: true, classes: { select: { current_semester: true } } },
  });
  const semester = student?.classes?.current_semester;

  if (!student || semester == null) {
    return { reply: endSentence(`I don't know what semester ${target.name} is in`), intent: 'get_semester_dates', confidence: 1 };
  }

  const calendar = await prisma.academic_calendars.findUnique({
    where: { batch_id_semester: { batch_id: student.batch_id, semester } },
    select: { start_date: true, end_date: true },
  });

  if (!calendar) {
    return { reply: endSentence(`No academic calendar is on record for ${target.name}'s semester ${semester}`), intent: 'get_semester_dates', confidence: 1 };
  }

  const who = possessive(user, target);
  const today = new Date(new Date().toISOString().slice(0, 10));
  const end = new Date(calendar.end_date.toISOString().slice(0, 10));
  const status = end < today ? ' (already ended)' : '';

  return {
    reply: `${who} Semester ${semester} runs from ${toDateOnly(calendar.start_date)} to ${toDateOnly(calendar.end_date)}${status}.`,
    intent: 'get_semester_dates',
    confidence: 1,
    data: { semester, ...calendar },
  };
}

async function currentActiveSemester(): Promise<ChatReply> {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const calendar = await prisma.academic_calendars.findFirst({
    where: { start_date: { lte: today }, end_date: { gte: today } },
    select: { semester: true, start_date: true, end_date: true, batches: { select: { name: true } } },
  });

  if (!calendar) {
    return {
      reply: "I don't see an academic calendar entry that's currently active for any batch — no semester is on record as running today.",
      intent: 'get_semester_dates',
      confidence: 1,
    };
  }

  return {
    reply: `The current active term is Semester ${calendar.semester} for batch ${calendar.batches.name}, running ${toDateOnly(calendar.start_date)} to ${toDateOnly(calendar.end_date)}.`,
    intent: 'get_semester_dates',
    confidence: 1,
    data: calendar,
  };
}
