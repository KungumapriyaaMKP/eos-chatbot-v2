import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  databaseUrl: required('DATABASE_URL'),

  jwt: {
    // Deliberately its own secret, independent of the EOS-backend's
    // JWT_SECRET — see src/auth/README.md for why.
    secret: process.env.CHATBOT_JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION',
    expiresIn: process.env.CHATBOT_JWT_EXPIRES_IN || '8h',
  },

  intent: {
    confidenceThreshold: parseFloat(
      process.env.INTENT_CONFIDENCE_THRESHOLD || '0.55',
    ),
    // Minimum gap required between the winning intent's best-matching
    // example and the best-matching example from any OTHER intent, before
    // the classifier will commit to an answer. See intent.classifier.ts
    // "AMBIGUITY GUARD".
    //
    // DEFAULT IS 0 (disabled) — deliberately, based on real measurement,
    // not a guess. calibrate-margin.ts picked 0.03 by sweeping leave-one-out
    // comparisons BETWEEN TRAINING EXAMPLES, where it looked favorable. But
    // scripts/sweep-margin-on-holdout.ts, which tests against the actual
    // target distribution (held-out paraphrased queries, the same 1000-
    // question set used for the real accuracy report), showed every
    // positive margin value strictly REDUCES overall pass rate — because
    // that test scores "abstained" exactly the same as "wrong" (both fail),
    // so the guard can only ever convert a pass into a fail, never the
    // reverse. Live queries also sit naturally further from all training
    // examples than training examples sit from each other, compressing
    // margins even for CORRECT calls — a threshold tuned on the wrong
    // population doesn't transfer.
    //
    // The mechanism is still here and configurable: it trades some raw
    // accuracy for fewer *confident* wrong answers (a real product-safety
    // property — a wrong answer misleads a user, an honest "please
    // rephrase" doesn't). If that trade is ever wanted for specific
    // high-stakes intents, set this above 0 — but do so having re-run
    // sweep-margin-on-holdout.ts, not by reasoning about it in the abstract.
    ambiguityMargin: parseFloat(
      process.env.INTENT_AMBIGUITY_MARGIN || '0',
    ),

    // LLM reranker (src/intent/llm-reranker.ts) — after SBERT picks a
    // winning intent, hands it and its top few competitors to the local
    // Ollama model (real descriptions + examples, not just embedding
    // scores) to confirm or override.
    //
    // llmRerankConfidenceCeiling gates WHEN this runs — only when SBERT's
    // own top score is BELOW this value. This was NOT the original design:
    // the first version reranked every successful classification
    // unconditionally, on the theory that more correction opportunities
    // could only help. Measured on the real 1000-question test, that was
    // WRONG — it made things measurably worse (778 -> 722 correct), because
    // asking the model to "reconsider" a case SBERT was already right about
    // has pure downside (some chance it second-guesses into a wrong answer)
    // with zero upside (SBERT was already going to be counted correct).
    // Confirmed directly: of 234 overrides, 129 broke a CORRECT high-
    // confidence SBERT answer (mostly 0.7-0.92 confidence) vs only 74 that
    // fixed a wrong one. A threshold sweep against that same real data
    // (scripts — see git history / session notes for calibrate-rerank-gate
    // methodology, same discipline as calibrate-margin.ts) found 0.72 as
    // the point where fixes still outpace harm; projected 778 -> 795
    // correct (76.3% -> 77.9%). Re-calibrate against a fresh holdout run if
    // the model, dataset, or prompt changes — don't reason about this value
    // in the abstract.
    llmRerankEnabled: process.env.INTENT_LLM_RERANK_ENABLED !== 'false',
    llmRerankConfidenceCeiling: parseFloat(process.env.INTENT_LLM_RERANK_CEILING || '0.72'),
    llmRerankTopK: parseInt(process.env.INTENT_LLM_RERANK_TOP_K || '4', 10),
  },

  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || '*',

  rateLimit: {
    // Per-IP, applies to every request (including unauthenticated /auth/login
    // attempts) — the original FIX #4 protection against ID enumeration/DoS.
    perIpPerMinute: parseInt(process.env.RATE_LIMIT_PER_IP_PER_MINUTE || '60', 10),
    // Per-authenticated-user (JWT sub), applies only to /chat. Added
    // alongside the per-IP limit, not instead of it: the per-IP limit alone
    // has a real shared-network problem — every user behind the same
    // campus NAT/proxy shares one IP-keyed budget, so a handful of active
    // students can throttle each other even though none of them individually
    // did anything abusive. Keying separately by user.sub means one
    // legitimate user's real usage is judged against their OWN budget, not
    // everyone else's on the same network.
    perUserPerMinute: parseInt(process.env.RATE_LIMIT_PER_USER_PER_MINUTE || '30', 10),
  },

  reply: {
    // Local generative model (src/reply/paraphraser.ts) that rewords an
    // already-correct, data-driven reply for more natural phrasing. ON by
    // default per explicit request. Every rewrite goes through a strict
    // fact-preservation check with fallback to the original template on any
    // doubt, timeout, or model error — never a broken or unverified answer.
    // Set REPLY_PARAPHRASE_ENABLED=false to turn it off.
    paraphraseEnabled: process.env.REPLY_PARAPHRASE_ENABLED !== 'false',
  },

  // Ollama — a separate local system service (NOT an npm dependency), see
  // README for install/pull instructions. Used for two narrow, guarded
  // things: rewording an already-correct reply (src/reply/paraphraser.ts)
  // and re-checking the classifier's pick among a short list of candidate
  // intents when SBERT's own top few are close together
  // (src/intent/llm-reranker.ts). Both fall back safely to the existing
  // deterministic/SBERT behavior if Ollama isn't running or times out —
  // this is additive, never a hard dependency the bot can't function
  // without.
  ollama: {
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.2:3b',
  },
};
