import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getFeeBreakup({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_fee_breakup', confidence: 1 };
    }

    return {
      reply: `**Fee Breakup for Your Class**\n\nYou can view the detailed fee components and structure on the student fee portal.`,
      intent: 'get_fee_breakup',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch fee breakup.', intent: 'get_fee_breakup', confidence: 1 };
  }
}

export async function getDDStatus({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_dd_status', confidence: 1 };
    }

    return {
      reply: `**Your Demand Draft Status**\n\nYou can check the status of your demand drafts on the fee management portal.`,
      intent: 'get_dd_status',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch DD status.', intent: 'get_dd_status', confidence: 1 };
  }
}
