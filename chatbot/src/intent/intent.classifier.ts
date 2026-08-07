import fs from 'node:fs';
import path from 'node:path';
import { embedText } from './embedder';
import { env } from '../config/env';
import { logger } from '../utils/logger';
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
 */
export async function classifyIntent(message: string): Promise<IntentMatch> {
  loadArtifacts();

  const queryVector = await embedText(message);

  let bestScore = -1;
  let bestIntent: string | null = null;
  let bestExample: string | null = null;

  for (const example of embeddings!.examples) {
    const score = dot(queryVector, example.vector);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = example.intent;
      bestExample = example.text;
    }
  }

  if (bestIntent === null || bestScore < env.intent.confidenceThreshold) {
    return { intent: null, confidence: Math.max(bestScore, 0), matchedExample: null, roles: [], module: null };
  }

  const definition = intentsByName!.get(bestIntent);

  return {
    intent: bestIntent,
    confidence: bestScore,
    matchedExample: bestExample,
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
