/**
 * ⚠ CAUTION — this leave-one-out calibration does NOT transfer to real
 * queries. It picked margin=0.03 as favorable, but scripts/sweep-margin-on-
 * holdout.ts (which tests against actual held-out paraphrased queries, the
 * real target distribution) showed every positive margin value REDUCES
 * overall accuracy — training examples sit closer to each other than live
 * queries sit to any training example, so a margin tuned here is
 * systematically too aggressive in production. Kept for reference / future
 * recalibration attempts, but treat sweep-margin-on-holdout.ts as
 * authoritative, not this file. See src/config/env.ts ambiguityMargin.
 *
 * Calibrates the margin-based ambiguity guard added to intent.classifier.ts.
 *
 * For every training example (leave-one-out, same method as
 * audit-classifier-consistency.ts), records:
 *   - bestScore / bestIntent: nearest OTHER example's score/intent
 *   - runnerUpScore: nearest OTHER example's score among examples belonging
 *     to a DIFFERENT intent than bestIntent (i.e. the second-place intent,
 *     not just the second-place example)
 *   - margin = bestScore - runnerUpScore
 *   - correct = bestIntent === true intent
 *
 * Then sweeps candidate margin thresholds: "if margin < t, abstain instead
 * of answering" and reports, for each t, how many WRONG confident answers
 * get suppressed (good) vs how many CORRECT confident answers get wrongly
 * suppressed (cost — becomes a 'please rephrase' instead of a right answer).
 *
 * Usage: npx tsx scripts/calibrate-margin.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const EMBEDDINGS_PATH = path.join(__dirname, '..', 'src', 'embeddings', 'embeddings.json');

interface EmbeddedExample {
  intent: string;
  text: string;
  vector: number[];
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

async function main() {
  const embeddings: { examples: EmbeddedExample[] } = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));
  const threshold = 0.55;

  interface Row { text: string; trueIntent: string; bestIntent: string; bestScore: number; runnerUpScore: number; margin: number; correct: boolean; }
  const rows: Row[] = [];

  for (let i = 0; i < embeddings.examples.length; i++) {
    const target = embeddings.examples[i];
    let bestScore = -1;
    let bestIntent: string | null = null;

    for (let j = 0; j < embeddings.examples.length; j++) {
      if (i === j) continue;
      const score = dot(target.vector, embeddings.examples[j].vector);
      if (score > bestScore) {
        bestScore = score;
        bestIntent = embeddings.examples[j].intent;
      }
    }

    if (bestScore < threshold || bestIntent === null) continue; // already abstains, not part of margin calibration

    // Find the best score among examples belonging to a DIFFERENT intent than bestIntent.
    let runnerUpScore = -1;
    for (let j = 0; j < embeddings.examples.length; j++) {
      if (i === j) continue;
      if (embeddings.examples[j].intent === bestIntent) continue;
      const score = dot(target.vector, embeddings.examples[j].vector);
      if (score > runnerUpScore) runnerUpScore = score;
    }

    rows.push({
      text: target.text,
      trueIntent: target.intent,
      bestIntent,
      bestScore,
      runnerUpScore,
      margin: bestScore - runnerUpScore,
      correct: bestIntent === target.intent,
    });
  }

  const totalCorrect = rows.filter((r) => r.correct).length;
  const totalWrong = rows.filter((r) => !r.correct).length;
  console.log(`Baseline (no margin guard): ${totalCorrect} correct, ${totalWrong} confidently wrong, out of ${rows.length} above-threshold examples.\n`);

  console.log('margin_t | wrong_suppressed (good) | correct_suppressed (cost) | net_correct_rate');
  for (const t of [0, 0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2]) {
    const wrongSuppressed = rows.filter((r) => !r.correct && r.margin < t).length;
    const correctSuppressed = rows.filter((r) => r.correct && r.margin < t).length;
    const stillCorrect = totalCorrect - correctSuppressed;
    const stillWrong = totalWrong - wrongSuppressed;
    const netRate = (stillCorrect / (stillCorrect + stillWrong + correctSuppressed + wrongSuppressed)) * 100;
    // "abstained" examples aren't wrong, aren't right — they become a safe rephrase prompt.
    console.log(
      `${t.toFixed(2)}     | ${String(wrongSuppressed).padStart(3)} / ${totalWrong}              | ${String(correctSuppressed).padStart(4)} / ${totalCorrect}               | correct=${stillCorrect} wrong=${stillWrong} abstain=${wrongSuppressed + correctSuppressed}`,
    );
  }

  // Show what's getting suppressed at a candidate margin (0.03) to sanity-check.
  const candidate = 0.03;
  console.log(`\n=== Sample of WRONG answers suppressed at margin=${candidate} (these become safe "please rephrase") ===`);
  rows.filter((r) => !r.correct && r.margin < candidate).slice(0, 10).forEach((r) => {
    console.log(`  "${r.text}" true=${r.trueIntent} predicted=${r.bestIntent} margin=${r.margin.toFixed(3)}`);
  });

  console.log(`\n=== Sample of CORRECT answers wrongly suppressed at margin=${candidate} (cost) ===`);
  rows.filter((r) => r.correct && r.margin < candidate).slice(0, 10).forEach((r) => {
    console.log(`  "${r.text}" intent=${r.trueIntent} margin=${r.margin.toFixed(3)}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
