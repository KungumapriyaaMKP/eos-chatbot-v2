import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { formatCurrency, toDateOnly, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/** get_fee_breakup — student (own) / admin (any student, looked up). Real fee_structure_items rows, itemized. */
export async function getFeeBreakup({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_fee_breakup', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their fee breakup', 'get_fee_breakup'), intent: 'get_fee_breakup', confidence: 1 };

  const demands = await prisma.student_fee_demand_mapping.findMany({
    where: { student_id: target.id },
    select: {
      academic_year: true,
      total_amount: true,
      fee_structures: { select: { name: true, fee_structure_items: { select: { amount: true, demand_categories: { select: { name: true } } } } } },
    },
  });

  const who = possessive(user, target);
  if (demands.length === 0) {
    return { reply: `${who} has no fee structure on record.`, intent: 'get_fee_breakup', confidence: 1 };
  }

  const rows = demands.flatMap((d) => d.fee_structures.fee_structure_items.map((item) => [item.demand_categories.name, formatCurrency(Number(item.amount))]));
  const table = markdownTable(['Component', 'Amount'], rows);

  return { reply: `${who} fee breakup (${demands[0].fee_structures.name}, ${demands[0].academic_year}):\n\n${table}`, intent: 'get_fee_breakup', confidence: 1, data: demands };
}

/** get_dd_status — student (own) / admin (any student, looked up). Real fee_payments rows with payment_mode='dd'. */
export async function getDDStatus({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_dd_status', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their demand draft status', 'get_dd_status'), intent: 'get_dd_status', confidence: 1 };

  const payments = await prisma.fee_payments.findMany({
    where: { payment_mode: 'dd', student_fee_demand_mapping: { student_id: target.id } },
    orderBy: { payment_date: 'desc' },
    select: { amount_paid: true, payment_date: true, receipt_no: true },
  });

  const who = possessive(user, target);
  if (payments.length === 0) {
    return { reply: `${who} has no demand draft payments on record.`, intent: 'get_dd_status', confidence: 1 };
  }

  const table = markdownTable(
    ['Date', 'Amount', 'Receipt'],
    payments.map((p) => [toDateOnly(p.payment_date), formatCurrency(Number(p.amount_paid)), p.receipt_no]),
  );
  return { reply: `${who} demand draft payments:\n\n${table}`, intent: 'get_dd_status', confidence: 1, data: payments };
}
