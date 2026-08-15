/**
 * Approves specific candidate training examples by id (sets approved_at),
 * after a human has actually looked at them via
 * scripts/review-training-candidates.ts — this is the explicit,
 * human-in-the-loop step the review-gate note in model-analyzer.service.ts
 * requires before a candidate is eligible for
 * merge-approved-training-examples.ts.
 *
 * Deliberately takes explicit ids, never "approve everything pending" —
 * an approve-all shortcut would just re-create the exact no-review problem
 * this script exists to close.
 *
 * Usage: npx tsx scripts/approve-training-candidates.ts <id> [id ...]
 */
import { prisma } from '../src/utils/prisma';

async function main() {
  const ids = process.argv.slice(2).map((s) => parseInt(s, 10));
  if (ids.length === 0 || ids.some((id) => Number.isNaN(id))) {
    console.error('Usage: npx tsx scripts/approve-training-candidates.ts <id> [id ...]');
    console.error('Find ids via: npx tsx scripts/review-training-candidates.ts');
    process.exit(1);
  }

  const now = new Date();
  let approved = 0;

  for (const id of ids) {
    const existing = await prisma.training_examples.findUnique({ where: { id } });
    if (!existing) {
      console.warn(`  ⚠ id ${id} not found — skipping.`);
      continue;
    }
    if (existing.approved_at) {
      console.log(`  - id ${id} ("${existing.query_text}") already approved on ${existing.approved_at.toISOString()} — skipping.`);
      continue;
    }
    await prisma.training_examples.update({ where: { id }, data: { approved_at: now } });
    console.log(`  ✔ Approved id ${id}: "${existing.query_text}" -> ${existing.intent_name}`);
    approved++;
  }

  console.log(`\n${approved} candidate(s) approved.`);
  if (approved > 0) {
    console.log('Next: npx tsx scripts/merge-approved-training-examples.ts');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
