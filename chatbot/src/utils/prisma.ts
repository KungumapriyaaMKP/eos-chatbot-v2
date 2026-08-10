import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';

/**
 * Single shared Prisma client, pointed at the SAME PostgreSQL database as
 * EOS-backend, generated from a verbatim copy of EOS-backend/prisma/schema.prisma
 * (no tables added, changed, or removed).
 *
 * This client is used strictly for READS. The chatbot has no business logic
 * that creates, updates, or deletes ERP data — every mutation flow (marking
 * attendance, entering marks, approving leave, etc.) stays exactly where it
 * already lives, in EOS-backend. Grep this codebase for `.create(`, `.update(`,
 * `.delete(`, `.upsert(` against `prisma.` — there should be none outside
 * this comment.
 */
// Connection pool configuration optimized for Supabase
// SESSION-mode pooler has 15 concurrent session limit per project
// TRANSACTION-mode pooler recommended for higher concurrency
const adapter = new PrismaPg({
  connectionString: env.databaseUrl,
  max: 15, // Increased to 15 for better concurrency
  min: 2, // Keep minimum connections alive
  idleTimeoutMillis: 45_000, // 45 seconds idle timeout
  connectionTimeoutMillis: 20_000, // 20 second connection timeout (increased from 10s)
  statement_timeout: 60_000, // 60 second query timeout (increased from 30s)
});

export const prisma = new PrismaClient({ adapter });
