import { logger } from '../utils/logger';
import { env } from '../config/env';
import { embedText } from '../intent/embedder';
import { generateText, checkOllamaReady } from '../utils/ollama';
import { NO_PERMISSION_MESSAGE } from '../utils/response';

/**
 * Rewords an already-correct, data-driven reply into more natural phrasing,
 * using a real local instruction-tuned model via Ollama (a separate local
 * system service, http://localhost:11434 by default — see README for
 * install/pull instructions; nothing leaves the machine, same fully-offline
 * posture as the SBERT classifier).
 *
 * Previously ran a tiny in-process model (Xenova/LaMini-Flan-T5-248M via
 * @xenova/transformers) — swapped to Ollama because that small model
 * visibly struggled to just follow "reword this, keep facts exact" (it
 * would outright refuse or misunderstand the task on a meaningful fraction
 * of attempts during testing). A real model run through Ollama follows
 * instructions far more reliably, so the safety net below actually gets to
 * pass a rewrite through more often instead of silently falling back.
 *
 * DELIBERATE SCOPE, UNCHANGED: this model NEVER decides what facts to say.
 * It only takes a sentence that the deterministic handlers in
 * src/services/*.ts already built from real Prisma data, and rewrites its
 * surface phrasing. That's what keeps this safe to add to a system that was
 * built "no LLM, no hallucination" for good reason (see embedder.ts /
 * LEARNING_PIPELINE.md) — the model has no path to inventing a wrong fee
 * amount or marks value from scratch, because it never sees the database,
 * only one already-correct sentence to reword.
 *
 * But a generative rewrite CAN still subtly corrupt a fact while wordsmithing
 * it (drop a digit, round a percentage, swap which number belongs to which
 * subject) — so every rewrite is verified against the original before use:
 * every numeric token and capitalized name-like word in the original must
 * still be present, unchanged, in the rewrite, and no NEW numeric token may
 * appear. Any mismatch, timeout, or model error silently falls back to the
 * original deterministic sentence — never a broken or unverified answer.
 */

const GENERATION_TIMEOUT_MS = 8000;

/** Logs whether Ollama is actually reachable/ready at startup — best-effort, never blocks boot (see server.ts). */
export async function warmUpParaphraser(): Promise<void> {
  if (!env.reply.paraphraseEnabled) return;
  const { reachable, modelPulled } = await checkOllamaReady();
  if (!reachable) {
    logger.warn('paraphraser', `Ollama not reachable at ${env.ollama.host} — replies will use the original template until it's running.`);
  } else if (!modelPulled) {
    logger.warn('paraphraser', `Ollama is running but "${env.ollama.model}" isn't pulled yet — run "ollama pull ${env.ollama.model}".`);
  } else {
    logger.log('paraphraser', `Ollama ready (${env.ollama.model}).`);
  }
}

/** Numeric tokens: 82, 82%, ₹4,500, 4500.50, 3/5 — anything that carries a fact this reply must not lose or gain. */
function extractNumericTokens(text: string): string[] {
  const matches = text.match(/[₹$]?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  return matches.map((m) => m.replace(/,/g, '')).sort();
}

// Pronouns and common sentence-starter words are structural, not factual —
// a safe rewrite can freely reorder sentences or merge clauses in ways that
// move/drop them entirely (e.g. "X is 91%. He attended..." -> "X, who
// attended..., is 91%.", or "Your fee is Y" -> "The fee owed is Y"). Only
// REAL proper nouns (student/subject names) need to survive intact.
//
// This used to be handled by skipping the first word of every SENTENCE
// (on the assumption only grammar, not names, forces a capital there) —
// but most admin/faculty/parent-facing replies open with the target
// student's own name via possessive() (student-lookup.util.ts), e.g.
// "Ganesh A.'s current attendance...". Skipping sentence-initial position
// meant that exact name was never checked, so a rewrite swapping in a
// DIFFERENT student's name there would sail through unnoticed — a real
// identity-mixup risk for exactly the replies where getting the name right
// matters most. Excluding by WORD instead of by POSITION fixes that.
const NON_NAME_WORDS = new Set([
  'he', 'she', 'it', 'you', 'i', 'we', 'they', 'his', 'her', 'its', 'your', 'my', 'our', 'their', 'him', 'them',
  'this', 'that', 'these', 'those', 'the', 'a', 'an', 'sorry', 'please', 'here', 'there', 'no', 'yes',
  'do', 'did', 'does', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'current', 'currently',
]);

/**
 * Capitalized, non-common words anywhere in the text — a cheap proxy for
 * names (student, subject, month, ...) that must survive the rewrite
 * untouched. Punctuation is stripped down to the alphanumeric core so
 * "A.'s" and "A." both normalize to "a", since a rewrite naturally drops/
 * adds possessive markers around a preserved name.
 */
function extractProperNounLike(text: string): string[] {
  const words = text.split(/\s+/);
  const found: string[] = [];
  for (const word of words) {
    if (!/^[A-Z]/.test(word)) continue;
    const core = word.replace(/['’]s$/i, '').replace(/[^a-zA-Z]/g, '');
    if (!core) continue;
    const lower = core.toLowerCase();
    if (NON_NAME_WORDS.has(lower)) continue;
    found.push(lower);
  }
  return found.sort();
}

/** Every "N of M" / "N out of M" / "N/M" ratio, as ordered pairs — catches a rewrite that transposes which number is which (e.g. "40 of 58" -> "58 of 40") that a plain bag-of-numbers comparison can't. */
function extractRatioPairs(text: string): string[] {
  const matches = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:out of|of|\/)\s*(\d[\d,]*(?:\.\d+)?)/gi)];
  return matches.map((m) => `${m[1].replace(/,/g, '')}:${m[2].replace(/,/g, '')}`).sort();
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Cosine similarity via the SAME embedding model used for intent classification (src/intent/embedder.ts) — reused here purely as a meaning-drift detector, no relation to intent matching. */
const SEMANTIC_SIMILARITY_FLOOR = 0.8;

/**
 * Verifies a candidate rewrite preserved every fact in the original AND
 * didn't drift off-topic. Deliberately strict — any doubt means "reject",
 * not "probably fine".
 *
 * The numeric/name checks alone missed real failures during testing:
 *  - A boilerplate message with no numbers or names in it ("Sorry, you
 *    don't have permission...") got "rewritten" into a completely
 *    unrelated sentence, and passed both checks vacuously (nothing to
 *    compare against) — the semantic-similarity check below is what
 *    actually catches that class of failure, that token-level checks
 *    structurally cannot.
 *  - A bag-of-numbers comparison can't tell "40 of 58" from a transposed
 *    "58 of 40" — same two numbers, wrong pairing — so ratio pairs are
 *    checked as ORDERED pairs, not just as a multiset.
 *  - The name check used to be one-directional (only "did every original
 *    name survive", never "did a NEW name get introduced"), unlike the
 *    numeric check which already rejects on length mismatch either way —
 *    now both directions are required, matching the numeric check's
 *    symmetry.
 */
async function isSafeRewrite(original: string, candidate: string): Promise<boolean> {
  const trimmed = candidate.trim();
  if (!trimmed) return false;

  // Guard against truncation or runaway rambling.
  if (trimmed.length < original.length * 0.5 || trimmed.length > original.length * 2.5) return false;

  if (!arraysEqual(extractNumericTokens(original), extractNumericTokens(trimmed))) return false;
  if (!arraysEqual(extractRatioPairs(original), extractRatioPairs(trimmed))) return false;
  if (!arraysEqual(extractProperNounLike(original), extractProperNounLike(trimmed))) return false;

  const [origVec, candVec] = await Promise.all([embedText(original), embedText(trimmed)]);
  if (dot(origVec, candVec) < SEMANTIC_SIMILARITY_FLOOR) return false;

  return true;
}

/**
 * Rewords `text` naturally, or returns it UNCHANGED if the model errors,
 * times out, or produces anything that fails the fact-preservation check.
 * Never throws — a broken paraphraser must never break a chat reply.
 */
export async function paraphraseReply(text: string): Promise<string> {
  if (!env.reply.paraphraseEnabled) return text;

  // Fixed boundary/policy messages (permission denials, etc.) are
  // deliberately constant wording, not up for a small model's rewording —
  // see utils/response.ts NO_PERMISSION_MESSAGE for why consistency matters
  // more than variety there.
  if (text === NO_PERMISSION_MESSAGE) return text;

  // Markdown tables (see utils/response.ts markdownTable) are structured
  // data the frontend parses into a real <table> — never let a generative
  // model anywhere near that, it will mangle the pipe/dash structure.
  if (text.includes('|') && /\|\s*---/.test(text)) return text;

  // Very short replies ("Thanks!", single-word) have nothing worth
  // rewording and the smallest surface for the model to go wrong on.
  if (text.trim().length < 15) return text;

  try {
    const prompt =
      `Reword the following sentence in a natural, friendly way. ` +
      `Keep every number, date, and name EXACTLY as written — do not add, remove, or change any fact. ` +
      `Reply with ONLY the reworded sentence, nothing else — no preamble, no quotes, no explanation.\n\n` +
      `Sentence: ${text}`;

    // Temperature 0 (greedy) — this is a fact-preservation task, not
    // creative writing; the more literal and deterministic the output, the
    // less chance of a dropped or altered number.
    const raw = await generateText(prompt, { temperature: 0, timeoutMs: GENERATION_TIMEOUT_MS });

    // Real chat-tuned models sometimes wrap the answer in quotes or a short
    // preamble despite being told not to — strip a wrapping pair of quotes
    // defensively before the fact-check runs.
    const candidate = raw.trim().replace(/^["']|["']$/g, '');

    if (await isSafeRewrite(text, candidate)) {
      return candidate.trim();
    }

    logger.log('paraphraser', `Rejected unsafe rewrite, using original. original="${text}" candidate="${candidate}"`);
    return text;
  } catch (err) {
    logger.warn('paraphraser', `Paraphrase failed, using original: ${(err as Error).message}`);
    return text;
  }
}
