import express, { type Express } from 'express';
import cors from 'cors';
import path from 'node:path';
import { apiRouter } from './routes';
import { errorHandler } from './middleware/errorHandler.middleware';
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

  // FIX #4: Rate limiting (prevents ID enumeration and DoS)
  const rateLimitMap = new Map<string, number>();
  const rateLimit = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = `${req.ip}:${Math.floor(Date.now() / 60000)}`; // 1 min window
    const count = (rateLimitMap.get(key) || 0) + 1;
    rateLimitMap.set(key, count);
    if (count > 60) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    next();
  };
  app.use(rateLimit);

  // Cleanup old rate limit entries every minute
  setInterval(() => {
    const now = Math.floor(Date.now() / 60000);
    for (const key of rateLimitMap.keys()) {
      const entryTime = parseInt(key.split(':')[1]);
      if (now - entryTime > 2) rateLimitMap.delete(key);
    }
  }, 60000);

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
