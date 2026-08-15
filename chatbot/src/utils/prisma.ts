import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';

/**
 * Single shared Prisma client, pointed at the SAME PostgreSQL database as
 * EOS-backend, generated from a verbatim copy of EOS-backend/prisma/schema.prisma
 * (no tables added, changed, or removed).
 *
 * This client is READ-ONLY against every real EOS/ERP table. No mutation
 * flow (marking attendance, entering marks, approving leave, etc.) is ever
 * duplicated here — those stay exactly where they already live, in
 * EOS-backend.
 *
 * EXCEPTION: 3 tables this chatbot owns itself — query_logs,
 * training_examples, model_performance (plain CREATE TABLE, no migration
 * framework, no relation to any EOS/ERP table) — DO get written to, by the
 * learning pipeline (src/services/learning/*.service.ts). Grepping for
 * `.create(`/`.update(`/`.delete(`/`.upsert(` against `prisma.` will find
 * those; that's expected and scoped to those 3 tables only. See README.md
 * "Learning pipeline" for the full picture.
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
