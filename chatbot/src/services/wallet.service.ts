import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getWalletBalance({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_wallet_balance', confidence: 1 };
    }

    return {
      reply: `**Your Campus Wallet**\n\nCheck your prepaid wallet balance for cafeteria, stationery, and other campus services. View transaction history on the student portal.`,
      intent: 'get_wallet_balance',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch wallet balance.', intent: 'get_wallet_balance', confidence: 1 };
  }
}

export async function rechargeWallet({ user, message }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'wallet_recharge', confidence: 1 };
    }

    return {
      reply: `**Recharge Campus Wallet**\n\nYou can recharge your wallet through the payment portal. Select your preferred amount and complete the transaction.`,
      intent: 'wallet_recharge',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to process wallet recharge.', intent: 'wallet_recharge', confidence: 1 };
  }
}
