import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { warmUpIntentClassifier } from './intent/intent.classifier';
import { warmUpParaphraser } from './reply/paraphraser';
import { prisma } from './utils/prisma';
import { startScheduledAnalysis } from './scripts/scheduled-analyzer';

const DEFAULT_JWT_SECRET = 'CHANGE_ME_IN_PRODUCTION';

/**
 * Refuses to boot in production with the default JWT secret still in
 * place — that string is now publicly documented (README, requirements.txt,
 * .env.example, this file), so leaving it unset in a real deployment means
 * anyone who's read this repo can forge a valid token for any user/role.
 * Every other NODE_ENV gets a loud warning instead of a hard failure, since
 * dev/test convenience (no .env fuss for a quick local run) still matters
 * there and the security stakes are much lower on localhost.
 */
function checkJwtSecret(): void {
  if (env.jwt.secret !== DEFAULT_JWT_SECRET) return;

  if (env.nodeEnv === 'production') {
    throw new Error(
      'CHATBOT_JWT_SECRET is unset (using the default placeholder) in a production environment. ' +
        'Refusing to start — this is a real forgeable-token risk, not a formality. Set CHATBOT_JWT_SECRET in .env.',
    );
  }

  logger.warn(
    'bootstrap',
    `CHATBOT_JWT_SECRET is unset — using the default placeholder. Fine for local dev, ` +
      `but this MUST be set to a real secret before any shared/production deployment.`,
  );
}

async function bootstrap() {
  checkJwtSecret();

  // Loads the SBERT model + trained embeddings once at startup, so the
  // first real /chat request isn't slow. Fails fast with a clear message if
  // `npm run train` hasn't been run yet.
  await warmUpIntentClassifier();

  // Best-effort only — unlike the classifier above, the paraphraser is
  // optional polish (see src/reply/paraphraser.ts): every reply already
  // works correctly without it. A failed download/load here (no network,
  // first-run not done yet) should never block the chatbot from starting;
  // paraphraseReply() falls back to the untouched original on any error
  // regardless, so a cold model just means slightly more template-y
  // replies until it's warmed up, not a broken deploy.
  warmUpParaphraser().catch((err) => {
    logger.warn('bootstrap', `Reply paraphraser failed to warm up (replies still work, just un-reworded): ${(err as Error).message}`);
  });

  // Deliberately NOT an eager await prisma.$connect() here — Prisma connects
  // lazily on first query. That means /health, utility intents (greeting,
  // help, thanks...) and RBAC/JWT checks all work even if the shared DB is
  // temporarily unreachable; only the handlers that actually query it fail,
  // with a normal 500 through the error middleware, not a boot-time crash.
  logger.log('bootstrap', `Database: ${env.databaseUrl.replace(/:[^:@]*@/, ':****@')} (connects lazily on first query).`);

  const app = createApp();

  // Start scheduled learning pipeline
  startScheduledAnalysis();

  const server = app.listen(env.port, () => {
    logger.log('bootstrap', `🤖 EOS Chatbot running on http://localhost:${env.port}`);
    logger.log('bootstrap', `   POST /auth/login  — temporary login (see src/auth/README.md)`);
    logger.log('bootstrap', `   POST /chat        — ask a question (Bearer token required)`);
    logger.log('bootstrap', `   POST /learning/feedback — record user feedback`);
    logger.log('bootstrap', `   GET /learning/stats — get query statistics`);
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
