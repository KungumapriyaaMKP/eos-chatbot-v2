import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function submitFeedbackForm({ user, message }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'submit_feedback_form', confidence: 1 };
    }

    return {
      reply: `**Submit Feedback**\n\nYour feedback helps us improve. Access the feedback portal to submit your responses to surveys and evaluations.`,
      intent: 'submit_feedback_form',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to access feedback form.', intent: 'submit_feedback_form', confidence: 1 };
  }
}

export async function getActiveSurveys({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_active_surveys', confidence: 1 };
    }

    return {
      reply: `**Active Surveys & Evaluations**\n\nView and respond to active surveys, course evaluations, and feedback forms assigned to you.`,
      intent: 'get_active_surveys',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch surveys.', intent: 'get_active_surveys', confidence: 1 };
  }
}
