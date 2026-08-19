import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { generateText } from '../utils/ollama';
import { env } from '../config/env';

/**
 * Real, per-user, persistent chat history -- a "Recents" sidebar the way
 * ChatGPT/Claude have one, backed by chat_conversations/chat_messages
 * (see prisma/schema.prisma). Deliberately a SEPARATE pair of tables from
 * query_logs: that table is anonymized-by-purpose classifier analytics
 * (no reply text, no conversation grouping, feeds the learning pipeline)
 * -- this one is the actual conversation transcript a user can reopen.
 *
 * Every read here is self-scoped by `userId` from the JWT, exactly like
 * every other handler in this codebase — a conversation that exists but
 * belongs to someone else is treated identically to one that doesn't
 * exist at all (returns null/false), never a distinguishing 403 that
 * would leak "yes, conversation #482 exists, it's just not yours".
 */

const TITLE_MAX_LENGTH = 60;
const TITLE_GENERATION_TIMEOUT_MS = 6000;

/** Plain truncation fallback — always available, no external dependency. */
function truncateTitle(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= TITLE_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, TITLE_MAX_LENGTH - 1).trimEnd() + '…';
}

/**
 * Short (3-6 word) title generated from the conversation's own first
 * message, via the same local Ollama instance already used for reranking/
 * paraphrasing — same fully-offline posture, and just as narrow a job:
 * summarizing a sentence the user themselves just typed into a short
 * label, never inventing a new fact about ERP data. Falls back to a
 * plain truncation on any failure/timeout/empty response — a title is
 * cosmetic, never worth a hard dependency on an LLM being up.
 */
export async function generateConversationTitle(firstMessage: string): Promise<string> {
  const fallback = truncateTitle(firstMessage);
  if (!env.reply.paraphraseEnabled) return fallback; // reuses the same on/off switch as the other narrow Ollama jobs

  try {
    const prompt =
      `Summarize the following chat message as a short title, 3 to 6 words, ` +
      `title case, no punctuation at the end, no quotes. ` +
      `Reply with ONLY the title, nothing else.\n\n` +
      `Message: ${firstMessage}`;

    const raw = await generateText(prompt, { temperature: 0.2, timeoutMs: TITLE_GENERATION_TIMEOUT_MS });
    const candidate = raw.trim().replace(/^["']|["']$/g, '').replace(/[.!?]+$/, '');

    if (!candidate || candidate.length > TITLE_MAX_LENGTH || candidate.split(/\s+/).length > 8) {
      return fallback;
    }
    return candidate;
  } catch (err) {
    logger.warn('chat-history', `Title generation failed, using truncation: ${(err as Error).message}`);
    return fallback;
  }
}

export interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: Date;
}

export interface ConversationMessage {
  role: 'user' | 'bot';
  message: string;
  intent: string | null;
  confidence: number | null;
  createdAt: Date;
}

/** Starts a brand-new conversation, titled from its own first message, and stores the opening exchange. */
export async function createConversation(
  userId: number,
  userMessage: string,
  botReply: string,
  intent: string | null,
  confidence: number | null,
): Promise<number> {
  const title = await generateConversationTitle(userMessage);

  const conversation = await prisma.chat_conversations.create({
    data: {
      user_id: userId,
      title,
      chat_messages: {
        create: [
          { role: 'user', message: userMessage },
          { role: 'bot', message: botReply, intent: intent ?? undefined, confidence: confidence ?? undefined },
        ],
      },
    },
    select: { id: true },
  });

  return conversation.id;
}

/**
 * Appends one exchange to an EXISTING conversation the caller owns.
 * Returns false (not an error) if the conversation doesn't exist or
 * belongs to someone else — the caller should treat that identically to
 * "start a new one instead", not surface a permission error.
 */
export async function appendToConversation(
  conversationId: number,
  userId: number,
  userMessage: string,
  botReply: string,
  intent: string | null,
  confidence: number | null,
): Promise<boolean> {
  const conversation = await prisma.chat_conversations.findUnique({
    where: { id: conversationId },
    select: { user_id: true },
  });
  if (!conversation || conversation.user_id !== userId) return false;

  await prisma.$transaction([
    prisma.chat_messages.createMany({
      data: [
        { conversation_id: conversationId, role: 'user', message: userMessage },
        { conversation_id: conversationId, role: 'bot', message: botReply, intent: intent ?? undefined, confidence: confidence ?? undefined },
      ],
    }),
    prisma.chat_conversations.update({ where: { id: conversationId }, data: { updated_at: new Date() } }),
  ]);

  return true;
}

const RECENTS_LIMIT = 50;

/** The caller's own conversations, most recently active first — the sidebar list. */
export async function listConversations(userId: number): Promise<ConversationSummary[]> {
  const rows = await prisma.chat_conversations.findMany({
    where: { user_id: userId },
    orderBy: { updated_at: 'desc' },
    take: RECENTS_LIMIT,
    select: { id: true, title: true, updated_at: true },
  });
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
}

/** Full transcript of one conversation, self-scoped. Null if it doesn't exist or isn't the caller's — same non-distinguishing treatment as appendToConversation. */
export async function getConversationMessages(conversationId: number, userId: number): Promise<ConversationMessage[] | null> {
  const conversation = await prisma.chat_conversations.findUnique({
    where: { id: conversationId },
    select: { user_id: true },
  });
  if (!conversation || conversation.user_id !== userId) return null;

  const rows = await prisma.chat_messages.findMany({
    where: { conversation_id: conversationId },
    orderBy: { created_at: 'asc' },
    select: { role: true, message: true, intent: true, confidence: true, created_at: true },
  });

  return rows.map((r) => ({
    role: r.role === 'bot' ? 'bot' : 'user',
    message: r.message,
    intent: r.intent,
    confidence: r.confidence ? Number(r.confidence) : null,
    createdAt: r.created_at,
  }));
}
