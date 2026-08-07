import type { Request, Response, NextFunction } from 'express';
import { classifyIntent } from '../intent/intent.classifier';
import { INTENT_HANDLERS } from '../intent/intent.registry';
import { isRoleAllowedForIntent } from '../middleware/rbac.middleware';
import { notWiredUp } from '../services/utility.service';
import { AppError } from '../utils/http-error';
import { logger } from '../utils/logger';
import { LOW_CONFIDENCE_MESSAGE, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

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

    const match = await classifyIntent(message);

    if (!match.intent) {
      const reply: ChatReply = { reply: LOW_CONFIDENCE_MESSAGE, intent: null, confidence: match.confidence };
      res.status(200).json(reply);
      return;
    }

    if (!isRoleAllowedForIntent(user.role, match.roles)) {
      logger.warn('chat', `RBAC denied: user=${user.sub} role=${user.role} intent=${match.intent}`);
      const reply: ChatReply = { reply: NO_PERMISSION_MESSAGE, intent: match.intent, confidence: match.confidence };
      res.status(200).json(reply);
      return;
    }

    const ctx: HandlerContext = { user, message, match };
    const handler = INTENT_HANDLERS[match.intent] ?? notWiredUp;

    const reply = await handler(ctx);
    res.status(200).json(reply);
  } catch (err) {
    next(err);
  }
}
