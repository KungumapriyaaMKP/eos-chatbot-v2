import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { matchSubjectInMessage } from './subject-match.util';
import { endSentence, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_marks — student (own, published results only) / parent (own child,
 * published only — same restriction the child themselves would have) /
 * admin (any student, any status — "Full access"). There's no student-safe
 * REST endpoint for this in EOS-backend yet (GET /exam-marks is
 * unauthenticated & unfiltered, GET /me/exam-marks is
 * faculty-own-entered-only) — see chatbot README, "Known backend gaps this
 * chatbot works around". Reads straight off exam_marks, self-scoped
 * exactly like every other handler here.
 */
export async function getMarks({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_marks', confidence: 1 };
  }

  if (!target) {
    return { reply: notFoundReply(user, result, 'their marks'), intent: 'get_marks', confidence: 1 };
  }

  const subject = await matchSubjectInMessage(message);
  const publishedOnly = user.role === ROLES.STUDENT || user.role === ROLES.PARENT;

  const rows = await prisma.exam_marks.findMany({
    where: {
      student_id: target.id,
      exam_subject_mapping: {
        ...(subject && { subject_id: subject.id }),
        // Students/parents only ever see published results; admin sees everything.
        ...(publishedOnly && { exams: { status: 'results_published' } }),
      },
    },
    select: {
      marks_obtained: true,
      max_marks: true,
      exam_subject_mapping: {
        select: {
          subjects: { select: { name: true } },
          exams: { select: { status: true, exam_types: { select: { name: true } } } },
        },
      },
    },
    orderBy: { entered_at: 'desc' },
  });

  if (rows.length === 0) {
    const scope = subject ? ` for ${subject.name}` : '';
    const reply =
      user.role === ROLES.STUDENT
        ? `No published marks${scope} yet.`
        : endSentence(`I don't see any marks${scope} for ${target.name}`);
    return { reply, intent: 'get_marks', confidence: 1 };
  }

  const who = possessive(user, target);
  const lines = rows.map((r) => {
    const subjectName = r.exam_subject_mapping.subjects.name;
    const examName = r.exam_subject_mapping.exams.exam_types.name;
    const scored = r.marks_obtained !== null ? r.marks_obtained.toString() : 'not entered';
    return `• ${subjectName} (${examName}): ${scored} / ${r.max_marks.toString()}`;
  });

  const reply = `${who} marks:\n\n${lines.join('\n')}`;

  return { reply, intent: 'get_marks', confidence: 1, data: rows };
}
