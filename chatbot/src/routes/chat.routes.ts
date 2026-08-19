import { Router } from 'express';
import { verifyJwt } from '../middleware/verifyJwt.middleware';
import { createRateLimit } from '../middleware/rateLimit.middleware';
import { env } from '../config/env';
import { chatHandler } from './chat.controller';
import { listConversations, getConversationMessages } from '../services/chat-history.service';
import { logger } from '../utils/logger';

export const chatRouter = Router();

// Per-authenticated-user rate limit, ON TOP OF (not instead of) the global
// per-IP limit in app.ts. Applied AFTER verifyJwt specifically so it can key
// on the real user id (JWT `sub`) — a shared campus NAT/proxy means the
// per-IP limit alone can throttle several unrelated students together even
// though none of them individually did anything abusive; this judges each
// authenticated user against their own budget instead.
const perUserChatRateLimit = createRateLimit({
  max: env.rateLimit.perUserPerMinute,
  keyFn: (req) => (req.user ? `user:${req.user.sub}` : null), // no verified user yet -> let verifyJwt's own 401 handle it, don't rate-limit the anonymous case here
});

// Every chatbot request requires a valid JWT (see src/auth/README.md for
// how this JWT is issued for now, and how to swap it for the real ERP's).
chatRouter.post('/', verifyJwt, perUserChatRateLimit, chatHandler);

/**
 * GET /chat/conversations — the caller's own "Recents" list (id, title,
 * last-active time), most recently active first. Self-scoped by the JWT
 * (req.user.sub) inside listConversations — there is no way to pass
 * another user's id in through this route at all.
 */
chatRouter.get('/conversations', verifyJwt, async (req, res, next) => {
  try {
    const conversations = await listConversations(req.user!.sub);
    res.json({ conversations });
  } catch (err) {
    logger.error('chat', `Failed to list conversations: ${err}`);
    next(err);
  }
});

/**
 * GET /chat/conversations/:id — full transcript of one conversation.
 * Returns 404 for a conversation that doesn't exist AND for one that
 * exists but belongs to someone else — deliberately the same response
 * either way (see chat-history.service.ts getConversationMessages), so
 * this endpoint can never be used to probe which conversation ids exist.
 */
chatRouter.get('/conversations/:id', verifyJwt, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid conversation id' });
    }

    const messages = await getConversationMessages(id, req.user!.sub);
    if (!messages) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({ id, messages });
  } catch (err) {
    logger.error('chat', `Failed to load conversation: ${err}`);
    next(err);
  }
});
