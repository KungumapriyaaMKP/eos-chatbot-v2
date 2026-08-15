import { pipeline, env as transformersEnv } from '@xenova/transformers';
import path from 'node:path';

/**
 * Runs paraphrase-multilingual-MiniLM-L12-v2 fully in-process via
 * @xenova/transformers (an ONNX Runtime port of the model — no Python, no
 * external AI service, no API key).
 *
 * Swapped from Xenova/all-MiniLM-L6-v2 (English-only, ~90MB) to get native-
 * script multilingual coverage (50+ languages) at a comparable storage
 * budget (~118MB quantized) — far smaller than other multilingual options
 * (LaBSE ~470MB, bge-m3 ~1GB+).
 *
 * This specific multilingual model was chosen over the (also-evaluated)
 * multilingual-e5-small: e5-small scored higher on general MTEB benchmarks,
 * but empirically it compressed this dataset's sentence pairs into an
 * overly narrow, hard-to-discriminate high-similarity range — a leave-one-
 * out self-consistency audit (scripts/audit-classifier-consistency.ts)
 * showed 211/2187 confident misclassifications vs. 177/2187 for this model.
 * paraphrase-multilingual-MiniLM-L12-v2 shares the same paraphrase-
 * identification training objective (sentence-transformers project) as the
 * original English MiniLM, which is why it discriminates near-duplicate
 * intents noticeably better than e5's retrieval-oriented training. No input
 * prefix is required (unlike E5).
 *
 * The ONNX weights are fetched ONCE from the Hugging Face model hub on first
 * run and cached under .transformers-cache/. Every request after that —
 * including every /chat call at runtime — runs entirely offline against the
 * local cache. See README.md "Fully offline / air-gapped setup" for how to
 * pre-seed the cache and disable remote fetching entirely.
 *
 * Used identically by:
 *  - src/training/build-embeddings.ts (embeds every dataset example once)
 *  - src/intent/intent.classifier.ts (embeds each incoming user message)
 * Both MUST use the same model/pooling/normalization so vectors live in the
 * same space and cosine similarity is meaningful.
 */

const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

transformersEnv.cacheDir = path.join(__dirname, '..', '..', '.transformers-cache');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractorPromise: Promise<any> | null = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_ID, { quantized: true });
  }
  return extractorPromise;
}

/** Embeds one string into a 384-dim, L2-normalized SBERT sentence vector. */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

/** Warms up the model (downloads/loads it) without embedding anything real. */
export async function warmUpEmbedder(): Promise<void> {
  await getExtractor();
}

export const EMBEDDING_MODEL_ID = MODEL_ID;
