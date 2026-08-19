/**
 * Creates the two chat-history tables (chat_conversations, chat_messages)
 * this chatbot owns for a real, per-user "Recents" sidebar in the chat
 * UI -- distinct from query_logs (anonymized-by-purpose classifier
 * analytics, no reply text, no conversation grouping). Plain CREATE
 * TABLE, no migration framework, matching how query_logs/
 * training_examples/model_performance were originally created.
 *
 * Usage: npx tsx scripts/create-chat-history-tables.ts
 */
import { prisma } from '../src/utils/prisma';

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('✔ chat_conversations ready.');

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_chat_conversations_user
      ON chat_conversations (user_id, updated_at DESC);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      role VARCHAR(10) NOT NULL,
      message TEXT NOT NULL,
      intent VARCHAR(100),
      confidence DECIMAL(4, 3),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('✔ chat_messages ready.');

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
      ON chat_messages (conversation_id, created_at);
  `);

  console.log('Done. Run `npm run prisma:generate` next.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
