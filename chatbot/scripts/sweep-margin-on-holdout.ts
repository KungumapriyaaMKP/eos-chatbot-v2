/**
 * Calibrates the ambiguity-margin guard against the actual target
 * distribution — held-out paraphrased queries (the same 1000-question set
 * used for the real accuracy report) — instead of leave-one-out comparisons
 * between training examples (calibrate-margin.ts), which turned out NOT to
 * transfer: a margin picked from training-vs-training comparisons was way
 * too aggressive on live queries, whose scores sit naturally closer
 * together because they're further from ALL training examples in general.
 *
 * Embeds each held-out question ONCE, records bestScore/bestIntent/
 * runnerUpScore, then sweeps candidate margins in memory (cheap — no
 * re-embedding per candidate).
 *
 * Usage: npx tsx scripts/sweep-margin-on-holdout.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { embedText } from '../src/intent/embedder';
import { BASE_QUESTIONS, expand } from './generate-1000-questions';

const EMBEDDINGS_PATH = path.join(__dirname, '..', 'src', 'embeddings', 'embeddings.json');
const THRESHOLD = 0.55;

interface EmbeddedExample { intent: string; text: string; vector: number[]; }
function dot(a: number[], b: number[]): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

async function main() {
  const embeddings: { examples: EmbeddedExample[] } = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));

  interface Row { question: string; trueIntent: string; bestIntent: string | null; bestScore: number; runnerUpScore: number; }
  const rows: Row[] = [];

  const intentNames = Object.keys(BASE_QUESTIONS);
  const perBase = 4;
  let done = 0;
  const total = intentNames.reduce((sum, name) => sum + BASE_QUESTIONS[name].length * perBase, 0);

  for (const intent of intentNames) {
    const questions = expand(BASE_QUESTIONS[intent], perBase);
    for (const question of questions) {
      const qv = await embedText(question);
      let bestScore = -1, bestIntent: string | null = null;
      for (const ex of embeddings.examples) {
        const s = dot(qv, ex.vector);
        if (s > bestScore) { bestScore = s; bestIntent = ex.intent; }
      }
      let runnerUpScore = -1;
      if (bestIntent !== null) {
        for (const ex of embeddings.examples) {
          if (ex.intent === bestIntent) continue;
          const s = dot(qv, ex.vector);
          if (s > runnerUpScore) runnerUpScore = s;
        }
      }
      rows.push({ question, trueIntent: intent, bestIntent, bestScore, runnerUpScore });
      done++;
      if (done % 200 === 0) console.log(`  embedded ${done}/${total}...`);
    }
  }

  console.log(`\nmargin_t | pass_rate | correct | wrong | abstain_threshold | abstain_margin`);
  for (const t of [0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.05]) {
    let correct = 0, wrong = 0, abstainThresh = 0, abstainMargin = 0;
    for (const r of rows) {
      if (r.bestIntent === null || r.bestScore < THRESHOLD) { abstainThresh++; continue; }
      if (r.bestScore - r.runnerUpScore < t) { abstainMargin++; continue; }
      if (r.bestIntent === r.trueIntent) correct++; else wrong++;
    }
    const passRate = ((correct / rows.length) * 100).toFixed(1);
    console.log(`${t.toFixed(3)}    | ${passRate}%    | ${correct}     | ${wrong}    | ${abstainThresh}                | ${abstainMargin}`);
  }

  fs.writeFileSync(path.join(__dirname, '..', '..', '_holdout_margin_rows.json'), JSON.stringify(rows), 'utf-8');
  console.log('\n✔ Saved raw rows to _holdout_margin_rows.json for further inspection.');
}

main().catch((err) => { console.error(err); process.exit(1); });
