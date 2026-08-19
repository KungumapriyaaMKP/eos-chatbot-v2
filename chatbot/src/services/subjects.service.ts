import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { matchSemesterInMessage } from './subject-match.util';
import { endSentence, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_my_subjects — student (own) / parent (own child) / admin (any
 * student, looked up in the message). Reads class_subjects for the
 * student's class + current semester by default.
 *
 * Real gap found live: "what subject do i have in previous semester"
 * always showed the CURRENT semester's subjects regardless -- the
 * semester filter was hardcoded to `current_semester`, so "previous"/
 * "semester 3"/etc in the message was silently ignored entirely (the same
 * class of gap marks.service.ts already had a fix for -- this handler
 * just hadn't been wired up to matchSemesterInMessage yet).
 */
export async function getSubjects({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_my_subjects', confidence: 1 };
  }

  if (!target) {
    return { reply: notFoundReply(user, result, 'their subjects', 'get_my_subjects'), intent: 'get_my_subjects', confidence: 1 };
  }

  if (!target.class_id) {
    return {
      reply: endSentence(`${target.name} hasn't been assigned to a class yet, so there are no subjects to show`),
      intent: 'get_my_subjects',
      confidence: 1,
    };
  }

  const klass = await prisma.classes.findUnique({ where: { id: target.class_id }, select: { current_semester: true } });
  const semester = matchSemesterInMessage(message, klass?.current_semester) ?? klass?.current_semester ?? null;
  const isCurrentSemester = semester != null && semester === klass?.current_semester;

  const rows = await prisma.class_subjects.findMany({
    where: { class_id: target.class_id, ...(semester != null && { semester }) },
    select: { subjects: { select: { name: true, subject_code: true, credits: true } } },
  });

  if (rows.length === 0) {
    const scope = semester != null ? ` for semester ${semester}` : '';
    return { reply: `No subjects found for ${target.name}'s class${scope}.`, intent: 'get_my_subjects', confidence: 1 };
  }

  const who = possessive(user, target);
  const table = markdownTable(
    ['Subject', 'Code', 'Credits'],
    rows.map((r) => [r.subjects.name, r.subjects.subject_code, r.subjects.credits ?? '—']),
  );
  const scopeLabel = isCurrentSemester || semester == null ? ' this semester' : ` (semester ${semester})`;

  return { reply: `${who} subjects${scopeLabel}:\n\n${table}`, intent: 'get_my_subjects', confidence: 1, data: rows };
}
