import { prisma } from '../utils/prisma';
import { markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_active_surveys — student: feedback_forms targeted at their class or
 * batch that they haven't already answered (feedback_responses is keyed
 * per-question, so "answered" here means having submitted at least one
 * response to that form's questions).
 */
export async function getActiveSurveys({ user }: HandlerContext): Promise<ChatReply> {
  const student = await prisma.students.findUnique({ where: { user_id: user.sub }, select: { id: true, class_id: true, batch_id: true } });
  if (!student) {
    return { reply: "I couldn't find a student profile linked to your account.", intent: 'get_active_surveys', confidence: 1 };
  }

  // student.class_id is nullable (a student not yet assigned a class). A
  // bare `{ class_id: student.class_id }` inside the OR would become
  // `{ class_id: null }` when it's null, which Prisma turns into
  // `WHERE class_id IS NULL` — matching every batch-only-targeted form in
  // the ENTIRE system (they all have class_id null), not just this
  // student's own batch. Only include that OR branch when class_id is a
  // real value.
  const forms = await prisma.feedback_forms.findMany({
    where: {
      OR: [
        ...(student.class_id !== null ? [{ class_id: student.class_id }] : []),
        { batch_id: student.batch_id },
      ],
    },
    select: {
      id: true,
      title: true,
      created_at: true,
      feedback_questions: { select: { id: true, feedback_responses: { where: { student_id: student.id }, select: { id: true } } } },
    },
  });

  // "Pending" = at least one question still unanswered — NOT "every
  // question unanswered". The previous `.every(...)` treated a
  // partially-completed form (1 of 5 questions answered) as fully done and
  // silently dropped it from the list.
  const pending = forms.filter((f) => f.feedback_questions.length > 0 && f.feedback_questions.some((q) => q.feedback_responses.length === 0));

  if (pending.length === 0) {
    return { reply: "You have no pending surveys or feedback forms right now.", intent: 'get_active_surveys', confidence: 1 };
  }

  const table = markdownTable(['Title', 'Posted'], pending.map((f) => [f.title, f.created_at.toISOString().slice(0, 10)]));
  return { reply: `Surveys/feedback forms awaiting your response:\n\n${table}`, intent: 'get_active_surveys', confidence: 1, data: pending };
}
