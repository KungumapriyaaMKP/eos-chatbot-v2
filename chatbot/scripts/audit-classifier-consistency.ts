/**
 * Full classifier self-consistency audit — classifies EVERY example in the
 * trained dataset (not just a curated sample) and reports any that don't
 * land back on their own intent. This is exactly the class of bug behind
 * two real fixes already found this session (faculty_my_classes vs
 * faculty_class_attendance, get_leave_status vs faculty_leave_status) —
 * doing it exhaustively catches every remaining collision instead of
 * waiting for the next live report.
 *
 * Each example is technically its own nearest neighbour (dot product with
 * itself = 1.0), so this doesn't test "does A classify as A" trivially —
 * it EXCLUDES the example itself from the candidate pool and asks "if this
 * exact example didn't exist, what's the nearest OTHER example, and is it
 * still the right intent?" That's a real, meaningful test of whether the
 * intent has enough of its OWN anchoring, not neighbouring intents'.
 *
 * Usage: npx tsx scripts/audit-classifier-consistency.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const INTENTS_PATH = path.join(__dirname, '..', 'src', 'embeddings', 'intents.json');
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
  const dataset = JSON.parse(fs.readFileSync(INTENTS_PATH, 'utf-8'));
  const embeddings: { examples: EmbeddedExample[] } = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));
  const threshold = 0.55; // matches env.intent.confidenceThreshold default

  console.log(`Auditing ${embeddings.examples.length} examples across ${dataset.intents.length} intents...\n`);

  let misclassified = 0;
  let belowThreshold = 0;
  const failures: Array<{ text: string; trueIntent: string; predicted: string | null; score: number }> = [];

  for (let i = 0; i < embeddings.examples.length; i++) {
    const target = embeddings.examples[i];
    let bestScore = -1;
    let bestIntent: string | null = null;

    for (let j = 0; j < embeddings.examples.length; j++) {
      if (i === j) continue; // exclude self
      const score = dot(target.vector, embeddings.examples[j].vector);
      if (score > bestScore) {
        bestScore = score;
        bestIntent = embeddings.examples[j].intent;
      }
    }

    if (bestScore < threshold) {
      belowThreshold++;
      continue; // not a misclassification — just an isolated/unique phrasing, expected for some examples
    }

    if (bestIntent !== target.intent) {
      misclassified++;
      failures.push({ text: target.text, trueIntent: target.intent, predicted: bestIntent, score: bestScore });
    }
  }

  console.log(`${misclassified} misclassified / ${embeddings.examples.length} total`);
  console.log(`${belowThreshold} scored below confidence threshold against all OTHER examples (expected for some unique phrasings, not itself a bug)\n`);

  if (failures.length > 0) {
    console.log('=== Misclassifications (grouped by true intent) ===\n');
    const byIntent = new Map<string, typeof failures>();
    for (const f of failures) {
      if (!byIntent.has(f.trueIntent)) byIntent.set(f.trueIntent, []);
      byIntent.get(f.trueIntent)!.push(f);
    }
    for (const [intent, group] of [...byIntent.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`${intent} (${group.length} misclassified):`);
      for (const f of group) {
        console.log(`  "${f.text}" -> predicted "${f.predicted}" (score=${f.score.toFixed(3)})`);
      }
      console.log();
    }
  }
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
