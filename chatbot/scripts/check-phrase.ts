import { classifyIntent } from '../src/intent/intent.classifier';

const phrases = process.argv.slice(2);

(async () => {
  for (const p of phrases) {
    const m = await classifyIntent(p);
    console.log(`"${p}" -> intent=${m.intent ?? '(none)'} confidence=${m.confidence.toFixed(3)} nearest="${m.matchedExample}"`);
  }
})();
