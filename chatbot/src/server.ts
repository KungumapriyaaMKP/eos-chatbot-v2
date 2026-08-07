import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { warmUpIntentClassifier } from './intent/intent.classifier';
import { prisma } from './utils/prisma';

async function bootstrap() {
  // Loads the SBERT model + trained embeddings once at startup, so the
  // first real /chat request isn't slow. Fails fast with a clear message if
  // `npm run train` hasn't been run yet.
  await warmUpIntentClassifier();

  // Deliberately NOT an eager await prisma.$connect() here — Prisma connects
  // lazily on first query. That means /health, utility intents (greeting,
  // help, thanks...) and RBAC/JWT checks all work even if the shared DB is
  // temporarily unreachable; only the handlers that actually query it fail,
  // with a normal 500 through the error middleware, not a boot-time crash.
  logger.log('bootstrap', `Database: ${env.databaseUrl.replace(/:[^:@]*@/, ':****@')} (connects lazily on first query).`);

  const app = createApp();

  const server = app.listen(env.port, () => {
    logger.log('bootstrap', `🤖 EOS Chatbot running on http://localhost:${env.port}`);
    logger.log('bootstrap', `   POST /auth/login  — temporary login (see src/auth/README.md)`);
    logger.log('bootstrap', `   POST /chat        — ask a question (Bearer token required)`);
  });

  // Releases the DB connection pool cleanly on shutdown — matters
  // specifically because the shared Supabase pooler this app talks to caps
  // total concurrent sessions institution-wide; an ungracefully killed
  // process (SIGKILL / force-stop) skips this and can leak a session until
  // it times out server-side. A normal Ctrl+C (SIGINT) or `kill` (SIGTERM)
  // hits this path correctly.
  const shutdown = async () => {
    logger.log('bootstrap', 'Shutting down, releasing the database connection pool...');
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  logger.error('bootstrap', 'Failed to start the chatbot', err);
  process.exit(1);
});
