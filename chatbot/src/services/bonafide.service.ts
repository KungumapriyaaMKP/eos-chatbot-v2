import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getBonafideStatus({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_bonafide_status', confidence: 1 };
    }

    return {
      reply: `**Bonafide Certificate**\n\nYou can download your bonafide certificate from the student portal or visit the office during working hours.`,
      intent: 'get_bonafide_status',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch bonafide status.', intent: 'get_bonafide_status', confidence: 1 };
  }
}
