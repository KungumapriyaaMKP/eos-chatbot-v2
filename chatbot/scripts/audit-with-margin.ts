import fs from 'node:fs';
import path from 'node:path';

const EMBEDDINGS_PATH = path.join(process.cwd(), 'src', 'embeddings', 'embeddings.json');

interface EmbeddedExample { intent: string; text: string; vector: number[]; }
function dot(a: number[], b: number[]): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]*b[i]; return s; }

const embeddings: { examples: EmbeddedExample[] } = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'));
const threshold = 0.55;
const margin = 0.03;

let correct = 0, wrong = 0, abstainMargin = 0, abstainThreshold = 0;
for (let i = 0; i < embeddings.examples.length; i++) {
  const target = embeddings.examples[i];
  let bestScore = -1, bestIntent: string | null = null;
  for (let j = 0; j < embeddings.examples.length; j++) {
    if (i === j) continue;
    const score = dot(target.vector, embeddings.examples[j].vector);
    if (score > bestScore) { bestScore = score; bestIntent = embeddings.examples[j].intent; }
  }
  if (bestScore < threshold || bestIntent === null) { abstainThreshold++; continue; }

  let runnerUp = -1;
  for (let j = 0; j < embeddings.examples.length; j++) {
    if (i === j) continue;
    if (embeddings.examples[j].intent === bestIntent) continue;
    const score = dot(target.vector, embeddings.examples[j].vector);
    if (score > runnerUp) runnerUp = score;
  }
  if (bestScore - runnerUp < margin) { abstainMargin++; continue; }

  if (bestIntent === target.intent) correct++; else wrong++;
}

console.log(`Total examples: ${embeddings.examples.length}`);
console.log(`Correct: ${correct}`);
console.log(`Wrong (confident misclassification): ${wrong}`);
console.log(`Abstained (below threshold): ${abstainThreshold}`);
console.log(`Abstained (ambiguous margin): ${abstainMargin}`);
console.log(`Accuracy among confident answers: ${(correct/(correct+wrong)*100).toFixed(1)}%`);
console.log(`Overall correct rate (of all examples): ${(correct/embeddings.examples.length*100).toFixed(1)}%`);
