import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getHostelRoom({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_hostel_room', confidence: 1 };
    }

    return {
      reply: `**Your Hostel Room Allocation**\n\nYou can view your current hostel room assignment on the hostel management portal.`,
      intent: 'get_hostel_room',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch hostel room details.', intent: 'get_hostel_room', confidence: 1 };
  }
}

export async function getHostelLedger({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_hostel_ledger', confidence: 1 };
    }

    return {
      reply: `**Your Hostel Ledger**\n\nYou can view your hostel fee ledger and transaction history on the portal.`,
      intent: 'get_hostel_ledger',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch hostel ledger.', intent: 'get_hostel_ledger', confidence: 1 };
  }
}

export async function getOutingStatus({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_outing_status', confidence: 1 };
    }

    return {
      reply: `**Your Outing Requests**\n\nYou can submit and track your outing requests on the hostel portal.`,
      intent: 'get_outing_status',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch outing status.', intent: 'get_outing_status', confidence: 1 };
  }
}
