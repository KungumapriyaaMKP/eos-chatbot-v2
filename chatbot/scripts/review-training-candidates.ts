/**
 * Lists PENDING (approved_at IS NULL) candidate training examples —
 * auto-collected by src/services/learning/model-analyzer.service.ts from
 * real user queries, but never auto-approved (see that file's review-gate
 * note). Read-only: this script only prints, it never mutates anything.
 *
 * Use this to decide what to hand to approve-training-candidates.ts — a
 * candidate is worth approving if the phrasing is genuinely representative
 * of how a real user would ask for that intent (not a fluke/one-off typo,
 * not mislabeled by a self-reported "that was correct" that happened to be
 * wrong).
 *
 * Usage: npx tsx scripts/review-training-candidates.ts
 */
import { prisma } from '../src/utils/prisma';

async function main() {
  const pending = await prisma.training_examples.findMany({
    where: { approved_at: null },
    orderBy: [{ intent_name: 'asc' }, { usage_count: 'desc' }],
  });

  if (pending.length === 0) {
    console.log('No pending candidates — nothing awaiting review.');
    await prisma.$disconnect();
    return;
  }

  console.log(`${pending.length} pending candidate(s), grouped by intent:\n`);

  let currentIntent: string | null = null;
  for (const c of pending) {
    if (c.intent_name !== currentIntent) {
      currentIntent = c.intent_name;
      console.log(`\n${currentIntent}:`);
    }
    console.log(`  [id ${c.id}] "${c.query_text}" (source=${c.source}, seen ${c.usage_count}x, confidence=${c.confidence ?? 'n/a'})`);
  }

  console.log(
    `\nTo approve specific ids: npx tsx scripts/approve-training-candidates.ts <id> [id ...]` +
      `\nApproved candidates then merge into the dataset via: npx tsx scripts/merge-approved-training-examples.ts`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
