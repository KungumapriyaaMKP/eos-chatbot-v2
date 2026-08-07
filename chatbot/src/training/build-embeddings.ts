/**
 * Second training step:
 *
 *   src/embeddings/intents.json  →  src/embeddings/embeddings.json
 *
 * Embeds every example utterance with SBERT (all-MiniLM-L6-v2, via
 * src/intent/embedder.ts) so the runtime classifier never has to touch the
 * model for anything but the live user message — matching against a
 * pre-computed vector table is just cosine similarity, no inference.
 *
 * Usage: npm run train:embed
 */
import fs from 'node:fs';
import path from 'node:path';
import { embedText, EMBEDDING_MODEL_ID, warmUpEmbedder } from '../intent/embedder';
import type { IntentDataset, EmbeddingsFile, EmbeddedExample } from '../intent/intent.types';

const INTENTS_PATH = path.join(__dirname, '..', 'embeddings', 'intents.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'embeddings', 'embeddings.json');

async function main() {
  if (!fs.existsSync(INTENTS_PATH)) {
    console.error(`✖ ${INTENTS_PATH} not found. Run "npm run train:parse" first.`);
    process.exit(1);
  }

  const dataset: IntentDataset = JSON.parse(fs.readFileSync(INTENTS_PATH, 'utf-8'));

  console.log(`Loading SBERT model (${EMBEDDING_MODEL_ID})...`);
  console.log('First run downloads ~90MB of ONNX weights and caches them under .transformers-cache/.');
  await warmUpEmbedder();
  console.log('Model ready.');

  const examples: EmbeddedExample[] = [];
  let done = 0;

  for (const intent of dataset.intents) {
    for (const text of intent.examples) {
      const vector = await embedText(text);
      examples.push({ intent: intent.name, text, vector });
      done += 1;
      if (done % 200 === 0) {
        console.log(`  embedded ${done}/${dataset.totalExamples}...`);
      }
    }
  }

  const dim = examples[0]?.vector.length ?? 0;

  const output: EmbeddingsFile = {
    model: EMBEDDING_MODEL_ID,
    dim,
    generatedAt: new Date().toISOString(),
    examples,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output), 'utf-8');

  console.log(`✔ Embedded ${examples.length} examples (dim=${dim}).`);
  console.log(`✔ Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('✖ Embedding build failed:', err);
  process.exit(1);
});
