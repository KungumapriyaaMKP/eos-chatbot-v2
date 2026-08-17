import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { matchSubjectInMessage, matchExamTypeInMessage, matchSemesterInMessage } from './subject-match.util';
import { endSentence, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
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
    return { reply: notFoundReply(user, result, 'their marks', 'get_marks'), intent: 'get_marks', confidence: 1 };
  }

  const [subject, examType, currentClass] = await Promise.all([
    matchSubjectInMessage(message, target.class_id),
    matchExamTypeInMessage(message),
    // Only needed to resolve "previous"/"last semester" (relative to the
    // student's OWN current semester) — see matchSemesterInMessage's
    // comment. A cheap single indexed lookup, worth it so "my previous
    // semester marks" doesn't just silently ignore "previous" the way it
    // did before this fix.
    target.class_id ? prisma.classes.findUnique({ where: { id: target.class_id }, select: { current_semester: true } }) : null,
  ]);
  const semester = matchSemesterInMessage(message, currentClass?.current_semester);
  const publishedOnly = user.role === ROLES.STUDENT || user.role === ROLES.PARENT;

  const rows = await prisma.exam_marks.findMany({
    where: {
      student_id: target.id,
      exam_subject_mapping: {
        ...(subject && { subject_id: subject.id }),
        exams: {
          ...(examType && { exam_type_id: examType.id }),
          ...(semester !== null && { semester }),
          // Students/parents only ever see published results; admin sees everything.
          ...(publishedOnly && { status: 'results_published' }),
        },
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

  const scopeParts = [subject?.name, examType?.name, semester !== null ? `semester ${semester}` : null].filter(
    (v): v is string => Boolean(v),
  );
  const scope = scopeParts.length > 0 ? ` for ${scopeParts.join(', ')}` : '';

  if (rows.length === 0) {
    const reply =
      user.role === ROLES.STUDENT
        ? `No published marks${scope} yet.`
        : endSentence(`I don't see any marks${scope} for ${target.name}`);
    return { reply, intent: 'get_marks', confidence: 1 };
  }

  const who = possessive(user, target);
  const table = markdownTable(
    ['Subject', 'Exam', 'Marks'],
    rows.map((r) => [
      r.exam_subject_mapping.subjects.name,
      r.exam_subject_mapping.exams.exam_types.name,
      `${r.marks_obtained !== null ? r.marks_obtained.toString() : 'not entered'} / ${r.max_marks.toString()}`,
    ]),
  );

  const reply = `${who} marks${scope}:\n\n${table}`;

  return { reply, intent: 'get_marks', confidence: 1, data: rows };
}
