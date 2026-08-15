import type { Request, Response, NextFunction } from 'express';
import { classifyIntent, getIntentDefinition } from '../intent/intent.classifier';
import { INTENT_HANDLERS } from '../intent/intent.registry';
import { isRoleAllowedForIntent } from '../middleware/rbac.middleware';
import { notWiredUp, suggestedTopicsFor } from '../services/utility.service';
import { getSessionContext } from '../intent/session-context';
import { SIBLING_INTENTS } from '../intent/sibling-intents';
import { AppError } from '../utils/http-error';
import { logger } from '../utils/logger';
import { pickLowConfidenceMessage, joinNaturally, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import { paraphraseReply } from '../reply/paraphraser';
import type { HandlerContext, IntentMatch } from '../intent/intent.types';
import { logQuery } from '../services/learning/query-logger.service';

/**
 * POST /chat — the entire pipeline described in the brief:
 *
 *   message → SBERT intent detection → RBAC check → intent handler
 *           → (calls the reused backend data via Prisma) → conversational reply
 *
 * Always resolves 200 with a `reply` string — including permission denials
 * and "please rephrase" — because this is a chat turn, not a REST resource;
 * only genuinely malformed requests (missing message) or unexpected server
 * failures go through the shared error middleware.
 */
export async function chatHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const message = req.body?.message;
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw AppError.badRequest('message is required');
    }

    const user = req.user!; // verifyJwt guarantees this is set

    let match = await classifyIntent(message);

    if (!match.intent) {
      // Classification failed on its own — but if this session is mid a
      // "which student did you mean?"-style clarification, this message is
      // very likely the answer to that (e.g. "ganesh from it dept 22it001":
      // a name + department + ID with no verb at all, which scores below
      // the confidence threshold as a fresh, standalone message). Re-try it
      // against the intent that actually asked the question instead of
      // dead-ending the conversation. See student-lookup.util.ts
      // notFoundReply / session-context.ts for where pendingIntent is set.
      const pendingIntent = getSessionContext(user.sub)?.pendingIntent;
      const pendingDefinition = pendingIntent ? getIntentDefinition(pendingIntent) : undefined;

      if (pendingIntent && pendingDefinition && isRoleAllowedForIntent(user.role, pendingDefinition.roles)) {
        match = {
          intent: pendingIntent,
          confidence: match.confidence,
          matchedExample: null,
          roles: pendingDefinition.roles,
          module: pendingDefinition.module,
        } satisfies IntentMatch;
      } else {
        // Genuinely failed classification (not even recognized as
        // out-of-scope) — every OTHER "can't help with that" reply in this
        // codebase (help(), notWiredUp(), the OOS_* redirects) points the
        // caller somewhere real; this fallback was the one that just said
        // "rephrase?" with no suggestion. Same suggestedTopicsFor(role)
        // used by help()/notWiredUp(), so it never drifts out of sync with
        // what's actually wired up for this caller.
        const topics = suggestedTopicsFor(user.role);
        const suggestion = topics.length > 0 ? `You could try asking about ${joinNaturally(topics)}.` : undefined;
        const reply: ChatReply = {
          reply: pickLowConfidenceMessage(match.confidence, suggestion),
          intent: null,
          confidence: match.confidence,
        };
        res.status(200).json(reply);
        return;
      }
    }

    if (!isRoleAllowedForIntent(user.role, match.roles)) {
      // Before denying outright, check whether this intent has a listed
      // "sibling" — the literal same question, asked from a different
      // role's vantage point (see sibling-intents.ts) — that DOES allow
      // this caller's role. A classifier that only sees text can't always
      // tell "check my leave application" (student) from the identical
      // sentence (faculty) apart; if the sibling fits, route there
      // instead of denying someone access to their own real data over a
      // coin-flip in which of two equivalent intents got matched.
      const sibling = (SIBLING_INTENTS[match.intent!] ?? [])
        .map((name: string) => getIntentDefinition(name))
        .find((def): def is NonNullable<typeof def> => def !== undefined && isRoleAllowedForIntent(user.role, def.roles));

      if (sibling) {
        logger.log('chat', `Rerouted via sibling intent: user=${user.sub} role=${user.role} ${match.intent} -> ${sibling.name}`);
        match = { intent: sibling.name, confidence: match.confidence, matchedExample: null, roles: sibling.roles, module: sibling.module };
      } else {
        logger.warn('chat', `RBAC denied: user=${user.sub} role=${user.role} intent=${match.intent}`);
        const reply: ChatReply = { reply: NO_PERMISSION_MESSAGE, intent: match.intent, confidence: match.confidence };
        res.status(200).json(reply);
        return;
      }
    }

    const ctx: HandlerContext = { user, message, match };
    const handler = INTENT_HANDLERS[match.intent!] ?? notWiredUp;

    const reply = await handler(ctx);

    // Reword the (already fact-correct) reply for more natural phrasing —
    // see src/reply/paraphraser.ts for why this can't corrupt the answer:
    // the model only rewords a sentence the handler already built from real
    // data, never decides facts itself, and any rewrite that fails a strict
    // fact-preservation check falls back to the original untouched.
    reply.reply = await paraphraseReply(reply.reply);

    // Log query for learning pipeline (async, non-blocking)
    logQuery({
      userId: user.sub,
      message,
      intentDetected: match.intent || undefined,
      confidence: match.confidence || undefined,
    }).catch(() => {}); // Ignore errors

    res.status(200).json(reply);
  } catch (err) {
    next(err);
  }
}
