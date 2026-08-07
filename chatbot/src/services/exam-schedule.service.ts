import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveTargetStudent, adminLookupPrompt, NO_LINKED_STUDENT_MESSAGE } from './student-lookup.util';
import { toDateOnly, formatHHMM, endSentence, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_exam_schedule — student (own class) / admin (any student's class).
 * EOS-backend's exam-timetable module is @Roles(COE)-only for every route
 * including GET, so there's no student-safe endpoint yet — see README
 * "Known backend gaps this chatbot works around". Reads exam_timetable via
 * exam_subject_mapping.class_id, same join a self-service endpoint would use.
 */
export async function getExamSchedule({ user, message }: HandlerContext): Promise<ChatReply> {
  const { student: target, forbidden } = await resolveTargetStudent(user, message);

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_exam_schedule', confidence: 1 };
  }

  if (!target) {
    const reply = user.role === ROLES.ADMIN ? adminLookupPrompt('their exam schedule') : NO_LINKED_STUDENT_MESSAGE;
    return { reply, intent: 'get_exam_schedule', confidence: 1 };
  }

  if (!target.class_id) {
    return {
      reply: endSentence(`${target.name} hasn't been assigned to a class yet, so there's no exam schedule to show`),
      intent: 'get_exam_schedule',
      confidence: 1,
    };
  }

  const isStudent = user.role === ROLES.STUDENT;

  const rows = await prisma.exam_timetable.findMany({
    where: {
      ...(isStudent && { is_published: true }),
      exam_subject_mapping: { class_id: target.class_id },
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
    return {
      reply: `No exam schedule has been published for ${target.name}'s class yet.`,
      intent: 'get_exam_schedule',
      confidence: 1,
    };
  }

  const who = user.role === ROLES.ADMIN ? `${target.name}'s` : 'Your';
  const lines = rows.map((r) => {
    const subjectName = r.exam_subject_mapping.subjects.name;
    const examName = r.exam_subject_mapping.exams.exam_types.name;
    return `• ${subjectName} (${examName}) – ${toDateOnly(r.exam_date)}, ${formatHHMM(r.start_time)}–${formatHHMM(r.end_time)}`;
  });

  return { reply: `${who} upcoming exams:\n\n${lines.join('\n')}`, intent: 'get_exam_schedule', confidence: 1, data: rows };
}
