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
  app.use(express.json());

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
