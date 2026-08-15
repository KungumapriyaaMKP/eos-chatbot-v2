import { Router } from 'express';
import { verifyJwt } from '../middleware/verifyJwt.middleware';
import { createRateLimit } from '../middleware/rateLimit.middleware';
import { env } from '../config/env';
import { chatHandler } from './chat.controller';

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
