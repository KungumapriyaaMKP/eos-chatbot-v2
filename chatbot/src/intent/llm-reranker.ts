import { generateText } from '../utils/ollama';
import { logger } from '../utils/logger';
import type { IntentDefinition } from './intent.types';

export interface RerankCandidate {
  intent: string;
  score: number;
  matchedExample: string;
}

/**
 * Asks the local Ollama model to pick the single best-fitting intent among
 * a short list of SBERT's top candidates, using each intent's real
 * description + a couple of real example phrasings for context — actual
 * reasoning about MEANING, not just embedding-space distance. Targets
 * exactly the near-duplicate-intent confusions embedding similarity alone
 * kept getting wrong all session (get_fees vs get_dd_status,
 * get_attendance vs section_performance, ...) — a reasoning model can be
 * TOLD the real distinction between two intents' descriptions in a way a
 * cosine-similarity score has no mechanism to represent.
 *
 * Returns null (meaning: "trust SBERT's own top pick") if Ollama is
 * unreachable, times out, or answers with something that isn't EXACTLY one
 * of the candidate names — this is a narrow, safe ADDITION on top of
 * classification, never a replacement path that could go rogue and invent
 * an intent that was never a real candidate.
 */
export async function rerankIntent(
  message: string,
  candidates: RerankCandidate[],
  getDefinition: (name: string) => IntentDefinition | undefined,
): Promise<string | null> {
  if (candidates.length < 2) return null;

  const listing = candidates
    .map((c, i) => {
      const def = getDefinition(c.intent);
      const examples = (def?.examples ?? []).slice(0, 2).map((e) => `"${e}"`).join(', ');
      return `${i + 1}. ${c.intent}: ${def?.description ?? ''} (e.g. ${examples})`;
    })
    .join('\n');

  const prompt =
    `A user sent this message to a college ERP chatbot: "${message}"\n\n` +
    `Which ONE of these intents best matches what they're actually asking? Consider the real meaning, not just keyword overlap.\n\n${listing}\n\n` +
    `Reply with ONLY the exact intent name from the list above, nothing else — no explanation, no punctuation.`;

  try {
    const raw = await generateText(prompt, { temperature: 0, timeoutMs: 8000 });
    // Models sometimes echo the "N. " numbering from the candidate listing
    // in the prompt back as part of the answer (e.g. "1. get_mentor")
    // despite being told to reply with just the name — strip that before
    // matching, or a perfectly correct answer gets discarded as
    // unrecognized purely over formatting.
    const cleaned = raw
      .trim()
      .replace(/^\d+[.)]\s*/, '')
      .replace(/^["']|["'.]$/g, '')
      .split('\n')[0]
      .trim();

    // Some answers are just the ordinal position ("1", "3.") rather than
    // the intent name, despite the prompt asking for the name — treat a
    // bare number as a 1-based index into the candidate list.
    const asIndex = /^(\d+)\.?$/.exec(cleaned);
    const match = asIndex
      ? candidates[Number(asIndex[1]) - 1]
      : candidates.find((c) => c.intent.toLowerCase() === cleaned.toLowerCase());

    if (!match) {
      logger.log('llm-reranker', `Unrecognized rerank answer "${cleaned}" for "${message}" — keeping SBERT's pick (${candidates[0].intent}).`);
      return null;
    }
    if (match.intent !== candidates[0].intent) {
      logger.log('llm-reranker', `Overrode SBERT: "${message}" ${candidates[0].intent}(${candidates[0].score.toFixed(3)}) -> ${match.intent}`);
    }
    return match.intent;
  } catch (err) {
    logger.warn('llm-reranker', `Rerank failed, keeping SBERT's pick: ${(err as Error).message}`);
    return null;
  }
}
