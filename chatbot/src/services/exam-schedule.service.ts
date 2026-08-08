import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { toDateOnly, formatHHMM, endSentence, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_exam_schedule — student (own class, published only) / parent (own
 * child's class, published only) / admin & coe (any student's class, any
 * status — coe is who actually manages exam publishing in EOS-backend, so
 * full visibility matches their real authority). EOS-backend's
 * exam-timetable module is @Roles(COE)-only for every route including GET,
 * so there's no student-safe endpoint yet — see README "Known backend gaps
 * this chatbot works around". Reads exam_timetable via
 * exam_subject_mapping.class_id, same join a self-service endpoint would use.
 *
 * The "published only" gate filters on exam_subject_mapping.is_published,
 * NOT exam_timetable — the dataset's own description says students should
 * only see published entries, and the schema.prisma copy this project
 * started from declared `is_published` on exam_timetable, but that column
 * has never actually existed on the live table. The real publish flag
 * turned out to live one join up, on exam_subject_mapping (confirmed via
 * information_schema; see the schema patch comment there). Genuine drift
 * between EOS-backend's checked-in schema and its deployed database, not
 * something introduced here.
 */
export async function getExamSchedule({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_exam_schedule', confidence: 1 };
  }

  if (!target) {
    return { reply: notFoundReply(user, result, 'their exam schedule', 'get_exam_schedule'), intent: 'get_exam_schedule', confidence: 1 };
  }

  if (!target.class_id) {
    return {
      reply: endSentence(`${target.name} hasn't been assigned to a class yet, so there's no exam schedule to show`),
      intent: 'get_exam_schedule',
      confidence: 1,
    };
  }

  const publishedOnly = user.role === ROLES.STUDENT || user.role === ROLES.PARENT;

  const rows = await prisma.exam_timetable.findMany({
    where: {
      exam_subject_mapping: {
        class_id: target.class_id,
        ...(publishedOnly && { is_published: true }),
      },
    },
    orderBy: { exam_date: 'asc' },
    select: {
      exam_date: true,
      start_time: true,
      end_time: true,
      exam_subject_mapping: {
        select: {
          subjects: { select: { name: true } },
          exams: { select: { exam_types: { select: { name: true } } } },
        },
      },
    },
  });

  if (rows.length === 0) {
    const reply = publishedOnly
      ? `No exam schedule has been published for ${target.name}'s class yet.`
      : `No exam schedule found for ${target.name}'s class yet.`;
    return { reply, intent: 'get_exam_schedule', confidence: 1 };
  }

  const who = possessive(user, target);
  const table = markdownTable(
    ['Subject', 'Exam', 'Date', 'Time'],
    rows.map((r) => [
      r.exam_subject_mapping.subjects.name,
      r.exam_subject_mapping.exams.exam_types.name,
      toDateOnly(r.exam_date),
      `${formatHHMM(r.start_time)}–${formatHHMM(r.end_time)}`,
    ]),
  );

  return { reply: `${who} upcoming exams:\n\n${table}`, intent: 'get_exam_schedule', confidence: 1, data: rows };
}
