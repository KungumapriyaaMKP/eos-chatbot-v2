import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getHallTicket({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_hall_ticket', confidence: 1 };
    }

    return {
      reply: `**Hall Ticket**\n\nYour hall ticket is ready. You can download it from the student portal or contact the examination office.`,
      intent: 'get_hall_ticket',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch hall ticket.', intent: 'get_hall_ticket', confidence: 1 };
  }
}

export async function getExamSeat({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_exam_seat', confidence: 1 };
    }

    return {
      reply: `**Your Exam Seating Arrangement**\n\nCheck the examination portal for your assigned exam hall, seat number, and other details.`,
      intent: 'get_exam_seat',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch exam seat arrangement.', intent: 'get_exam_seat', confidence: 1 };
  }
}

export async function getMarksheet({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_marksheet', confidence: 1 };
    }

    return {
      reply: `**Marksheet**\n\nYour marksheet is available on the student portal. You can download it or request an official copy from the office.`,
      intent: 'get_marksheet',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch marksheet.', intent: 'get_marksheet', confidence: 1 };
  }
}

export async function getRevaluationStatus({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_revaluation_status', confidence: 1 };
    }

    return {
      reply: `**Your Revaluation Requests**\n\nYou can track your revaluation requests and their status on the academic portal.`,
      intent: 'get_revaluation_status',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch revaluation status.', intent: 'get_revaluation_status', confidence: 1 };
  }
}
