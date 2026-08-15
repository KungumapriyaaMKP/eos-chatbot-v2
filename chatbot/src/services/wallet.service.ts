import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { formatCurrency, toDateOnly, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/** get_wallet_balance — student (own) / admin (any student, looked up). Real student_wallets + recent wallet_transactions. */
export async function getWalletBalance({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_wallet_balance', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their wallet balance', 'get_wallet_balance'), intent: 'get_wallet_balance', confidence: 1 };

  const wallet = await prisma.student_wallets.findUnique({
    where: { student_id: target.user_id },
    select: {
      balance: true,
      wallet_transactions: {
        orderBy: { created_at: 'desc' },
        take: 5,
        select: { txn_type: true, amount: true, status: true, created_at: true },
      },
    },
  });

  const who = possessive(user, target);
  if (!wallet) {
    return { reply: `${who} doesn't have a campus wallet set up.`, intent: 'get_wallet_balance', confidence: 1 };
  }

  const reply = `${who} campus wallet balance: ${formatCurrency(Number(wallet.balance))}.`;

  if (wallet.wallet_transactions.length === 0) {
    return { reply, intent: 'get_wallet_balance', confidence: 1, data: wallet };
  }

  const table = markdownTable(
    ['Date', 'Type', 'Amount', 'Status'],
    wallet.wallet_transactions.map((t) => [toDateOnly(t.created_at), t.txn_type, formatCurrency(Number(t.amount)), t.status]),
  );
  return { reply: `${reply}\n\nRecent transactions:\n\n${table}`, intent: 'get_wallet_balance', confidence: 1, data: wallet };
}
