import { env } from '../config/env';
import { withTimeout } from './timeout';

/**
 * Minimal client for a locally-running Ollama daemon (http://localhost:11434
 * by default — nothing leaves the machine, same "fully offline" posture as
 * the SBERT classifier). Ollama is a separate system service (not an npm
 * dependency) — see README for install/pull instructions. Every caller of
 * generateText must handle it being unreachable (service not started, model
 * not pulled yet) by falling back gracefully; this module never assumes
 * Ollama is up.
 */

export interface GenerateOptions {
  /** Sampling temperature. 0 = fully deterministic (greedy) — use for fact-preservation/classification tasks, not creative writing. */
  temperature?: number;
  timeoutMs?: number;
}

/**
 * Calls Ollama's /api/generate with a single prompt (no chat history/system
 * prompt plumbing needed for this project's narrow, single-turn uses:
 * rewording one sentence, or picking one intent from a short list).
 * Throws on any failure — callers are expected to catch and fall back, not
 * treat this as always-available infrastructure.
 */
export async function generateText(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  const { temperature = 0, timeoutMs = 8000 } = opts;

  const response = await withTimeout(
    fetch(`${env.ollama.host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.ollama.model,
        prompt,
        stream: false,
        options: { temperature },
      }),
    }),
    timeoutMs,
    'Ollama generate',
  );

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${await response.text().catch(() => '')}`);
  }

  const data = (await response.json()) as { response?: string };
  return data.response ?? '';
}

/** True if the Ollama daemon is reachable and the configured model is pulled — used at startup to warn (not fail) if the setup isn't ready yet. */
export async function checkOllamaReady(): Promise<{ reachable: boolean; modelPulled: boolean }> {
  try {
    const response = await withTimeout(fetch(`${env.ollama.host}/api/tags`), 3000, 'Ollama check');
    if (!response.ok) return { reachable: false, modelPulled: false };
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const modelPulled = (data.models ?? []).some((m) => m.name === env.ollama.model || m.name.startsWith(`${env.ollama.model}:`) || `${m.name}` === env.ollama.model);
    return { reachable: true, modelPulled };
  } catch {
    return { reachable: false, modelPulled: false };
  }
}
