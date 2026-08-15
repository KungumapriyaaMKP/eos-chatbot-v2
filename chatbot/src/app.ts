import express, { type Express } from 'express';
import cors from 'cors';
import path from 'node:path';
import { apiRouter } from './routes';
import { errorHandler } from './middleware/errorHandler.middleware';
import { createRateLimit } from './middleware/rateLimit.middleware';
import { env } from './config/env';

export function createApp(): Express {
  const app = express();

  app.use(
    cors({
      origin: env.allowedOrigins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  // FIX #1: Input size limit (prevents DoS via large messages)
  app.use(express.json({ limit: '10kb' }));

  // FIX #4: Rate limiting (prevents ID enumeration and DoS) — per-IP,
  // applies to every request including unauthenticated /auth/login
  // attempts. See middleware/rateLimit.middleware.ts and chat.routes.ts for
  // the additional per-authenticated-user limit on /chat specifically.
  app.use(createRateLimit({ max: env.rateLimit.perIpPerMinute, keyFn: (req) => req.ip ?? 'unknown' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'eos-chatbot' });
  });

  // Minimal manual test UI — see public/index.html. Plain static HTML/JS,
  // no build step, talks to /auth/login + /chat on this same origin.
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/', apiRouter);

  // Must be registered last — Express identifies error middleware by arity (4 params).
  app.use(errorHandler);

  return app;
}
