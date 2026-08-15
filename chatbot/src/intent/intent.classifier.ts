import fs from 'node:fs';
import path from 'node:path';
import { embedText } from './embedder';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { withTimeout } from '../utils/timeout';
import { rerankIntent } from './llm-reranker';
import type { EmbeddingsFile, IntentDataset, IntentDefinition, IntentMatch } from './intent.types';

const INTENTS_PATH = path.join(__dirname, '..', 'embeddings', 'intents.json');
const EMBEDDINGS_PATH = path.join(__dirname, '..', 'embeddings', 'embeddings.json');

let intentsByName: Map<string, IntentDefinition> | null = null;
let embeddings: EmbeddingsFile | null = null;

function loadArtifacts(): void {
  if (intentsByName && embeddings) return;

  if (!fs.existsSync(INTENTS_PATH) || !fs.existsSync(EMBEDDINGS_PATH)) {
    throw new Error(
      'Intent training artifacts are missing. Run "npm run train" ' +
        '(parses the dataset .docx and builds SBERT embeddings) before starting the server.',
    );
  }

  const dataset: IntentDataset = JSON.parse(fs.readFileSync(INTENTS_PATH, 'utf-8'));
  embeddings = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));

  intentsByName = new Map(dataset.intents.map((i) => [i.name, i]));

  logger.log(
    'intent-classifier',
    `Loaded ${dataset.intents.length} intents / ${embeddings!.examples.length} example embeddings ` +
      `(model=${embeddings!.model}, dim=${embeddings!.dim}).`,
  );
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Classifies one user message against every training example via cosine
 * similarity (a plain dot product, since every vector is already
 * L2-normalized by src/intent/embedder.ts). Nearest-neighbour rather than
 * per-intent centroid matching — this dataset intentionally includes typo
 * variants ("marsk" for "marks") and very short/very long phrasings of the
 * same intent, and averaging them into one centroid would blur exactly the
 * diversity the dataset was built to cover.
 *
 * Below env.intent.confidenceThreshold, no intent is returned at all — the
 * caller falls back to the "please rephrase" message, per the brief.
 *
 * AMBIGUITY GUARD: a high absolute score alone doesn't mean the match is
 * unambiguous — two semantically-close intents (e.g. get_fees vs.
 * get_fee_breakup, get_attendance vs. section_performance) can both score
 * high on the same message. So we also find the best score among examples
 * belonging to a DIFFERENT intent than the winner, and require the winner
 * to beat that runner-up by env.intent.ambiguityMargin before committing.
 *
 * env.intent.ambiguityMargin defaults to 0 (off) — see the long comment in
 * src/config/env.ts for why: a margin tuned on leave-one-out training-data
 * comparisons looked good in isolation but measurably HURT real accuracy
 * (65.7% -> 58.4% on the 1000-question held-out test) once actually
 * measured against live paraphrased queries, because that test scores an
 * abstain exactly the same as a wrong answer. The mechanism stays here as
 * an opt-in safety trade (fewer confident-wrong answers, at a real accuracy
 * cost) for whoever owns that product decision later — re-run
 * scripts/sweep-margin-on-holdout.ts before ever changing this default.
 */
export async function classifyIntent(message: string): Promise<IntentMatch> {
  loadArtifacts();

  // FIX #2: Add timeout to prevent indefinite hangs
  const queryVector = await withTimeout(embedText(message), 5000, 'Intent classification');

  // Single pass: track the best-scoring example for EACH intent, not just
  // the single global best. Same O(n) cost as tracking only the global max
  // (one scan of every example either way) — and this per-intent ranking is
  // exactly what both the ambiguity margin guard and the LLM reranker below
  // need, so computing it up front replaces the old separate second pass
  // entirely rather than adding a new one.
  const bestByIntent = new Map<string, { score: number; example: string }>();
  for (const example of embeddings!.examples) {
    const score = dot(queryVector, example.vector);
    const existing = bestByIntent.get(example.intent);
    if (!existing || score > existing.score) {
      bestByIntent.set(example.intent, { score, example: example.text });
    }
  }

  const ranked = [...bestByIntent.entries()]
    .map(([intent, v]) => ({ intent, score: v.score, matchedExample: v.example }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < env.intent.confidenceThreshold) {
    return { intent: null, confidence: Math.max(best?.score ?? 0, 0), matchedExample: null, roles: [], module: null };
  }

  if (env.intent.ambiguityMargin > 0) {
    const runnerUp = ranked[1];
    const margin = best.score - (runnerUp?.score ?? -1);
    if (margin < env.intent.ambiguityMargin) {
      logger.log(
        'intent-classifier',
        `Ambiguous match suppressed: "${message}" best=${best.intent}(${best.score.toFixed(3)}) margin=${margin.toFixed(3)} < ${env.intent.ambiguityMargin}`,
      );
      return { intent: null, confidence: best.score, matchedExample: null, roles: [], module: null };
    }
  }

  let finalIntent = best.intent;
  let finalScore = best.score;
  let finalExample: string | null = best.matchedExample;

  // LLM RERANK: hand SBERT's top-K candidates (with their REAL descriptions
  // and example phrasings, not just scores) to the local Ollama model to
  // confirm or override — see llm-reranker.ts for why this catches
  // near-duplicate-intent confusions plain embedding similarity can't
  // (get_fees vs get_dd_status, get_attendance vs section_performance, ...).
  // Falls back to SBERT's own pick instantly on any failure.
  //
  // GATED by confidence — only runs when best.score is BELOW
  // llmRerankConfidenceCeiling. See env.ts for the full story: reranking
  // EVERY successful classification (no gate) was measured to hurt overall
  // accuracy, not help it, because asking the model to reconsider a case
  // SBERT was already confidently right about has only downside risk.
  if (env.intent.llmRerankEnabled && best.score < env.intent.llmRerankConfidenceCeiling) {
    const topK = ranked.slice(0, env.intent.llmRerankTopK);
    const reranked = await rerankIntent(message, topK, (name) => intentsByName!.get(name));
    if (reranked && reranked !== finalIntent) {
      const rerankedEntry = bestByIntent.get(reranked);
      finalIntent = reranked;
      finalScore = rerankedEntry?.score ?? best.score;
      finalExample = rerankedEntry?.example ?? null;
    }
  }

  const definition = intentsByName!.get(finalIntent);

  return {
    intent: finalIntent,
    confidence: finalScore,
    matchedExample: finalExample,
    roles: definition?.roles ?? [],
    module: definition?.module ?? null,
  };
}

export function getIntentDefinition(name: string): IntentDefinition | undefined {
  loadArtifacts();
  return intentsByName!.get(name);
}

export function getAllIntents(): IntentDefinition[] {
  loadArtifacts();
  return [...intentsByName!.values()];
}

/** Loads the model + artifacts eagerly (called once at server startup so the first real chat request isn't slow). */
export async function warmUpIntentClassifier(): Promise<void> {
  loadArtifacts();
  await embedText('warm up');
}
