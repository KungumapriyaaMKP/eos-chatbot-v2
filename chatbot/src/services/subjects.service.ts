import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveTargetStudent, adminLookupPrompt, NO_LINKED_STUDENT_MESSAGE } from './student-lookup.util';
import { endSentence, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_my_subjects — student (own) / admin (any student, looked up in the
 * message). Reads class_subjects for the student's class + current semester.
 */
export async function getSubjects({ user, message }: HandlerContext): Promise<ChatReply> {
  const { student: target, forbidden } = await resolveTargetStudent(user, message);

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_my_subjects', confidence: 1 };
  }

  if (!target) {
    const reply = user.role === ROLES.ADMIN ? adminLookupPrompt('their subjects') : NO_LINKED_STUDENT_MESSAGE;
    return { reply, intent: 'get_my_subjects', confidence: 1 };
  }

  if (!target.class_id) {
    return {
      reply: endSentence(`${target.name} hasn't been assigned to a class yet, so there are no subjects to show`),
      intent: 'get_my_subjects',
      confidence: 1,
    };
  }

  const klass = await prisma.classes.findUnique({ where: { id: target.class_id }, select: { current_semester: true } });

  const rows = await prisma.class_subjects.findMany({
    where: { class_id: target.class_id, ...(klass?.current_semester != null && { semester: klass.current_semester }) },
    select: { subjects: { select: { name: true, subject_code: true, credits: true } } },
  });

  if (rows.length === 0) {
    return { reply: `No subjects found for ${target.name}'s class.`, intent: 'get_my_subjects', confidence: 1 };
  }

  const who = user.role === ROLES.ADMIN ? `${target.name}'s` : 'Your';
  const lines = rows.map((r) => `• ${r.subjects.name} (${r.subjects.subject_code})`);

  return { reply: `${who} subjects this semester:\n\n${lines.join('\n')}`, intent: 'get_my_subjects', confidence: 1, data: rows };
}
