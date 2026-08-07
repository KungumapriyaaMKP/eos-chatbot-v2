import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { formatCurrency, toDateOnly, endSentence, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

const HISTORY_PATTERN = /\b(history|paid so far|payment history|receipts?|transactions?)\b/i;

/**
 * get_fees — student (own) / parent (own child) / admin (any student).
 * Every fee-billing route in EOS-backend is @Roles(ADMIN)-only with no
 * self-service path at all, so there's no endpoint a student JWT could
 * call for "my fees" today — see README "Known backend gaps this chatbot
 * works around". Reads student_fee_demand_mapping + fee_payments directly,
 * same aggregation a self-service endpoint would do.
 */
export async function getFees({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_fees', confidence: 1 };
  }

  if (!target) {
    return { reply: notFoundReply(user, result, 'their fee status'), intent: 'get_fees', confidence: 1 };
  }

  const demands = await prisma.student_fee_demand_mapping.findMany({
    where: { student_id: target.id },
    select: {
      id: true,
      total_amount: true,
      academic_year: true,
      fee_payments: { select: { amount_paid: true, payment_date: true, receipt_no: true, payment_mode: true } },
    },
  });

  if (demands.length === 0) {
    return { reply: endSentence(`I don't see a fee record for ${target.name}`), intent: 'get_fees', confidence: 1 };
  }

  const who = possessive(user, target);

  if (HISTORY_PATTERN.test(message)) {
    const payments = demands.flatMap((d) => d.fee_payments);
    if (payments.length === 0) {
      return {
        reply: `${who} payment history is empty. No payments have been recorded yet.`,
        intent: 'get_fees',
        confidence: 1,
      };
    }
    payments.sort((a, b) => b.payment_date.getTime() - a.payment_date.getTime());
    const lines = payments.map(
      (p) => `• ${formatCurrency(Number(p.amount_paid))} on ${toDateOnly(p.payment_date)} (receipt ${p.receipt_no})`,
    );
    return { reply: `${who} payment history:\n\n${lines.join('\n')}`, intent: 'get_fees', confidence: 1, data: payments };
  }

  const totalDemand = demands.reduce((sum, d) => sum + Number(d.total_amount), 0);
  const totalPaid = demands.reduce(
    (sum, d) => sum + d.fee_payments.reduce((s, p) => s + Number(p.amount_paid), 0),
    0,
  );
  const pending = Math.max(totalDemand - totalPaid, 0);

  const reply =
    pending === 0
      ? `${who} fees are fully paid: ${formatCurrency(totalPaid)} out of ${formatCurrency(totalDemand)}.`
      : `${who} fee status: ${formatCurrency(totalPaid)} paid out of ${formatCurrency(totalDemand)}, ` +
        `${formatCurrency(pending)} still pending.`;

  return { reply, intent: 'get_fees', confidence: 1, data: { totalDemand, totalPaid, pending } };
}
