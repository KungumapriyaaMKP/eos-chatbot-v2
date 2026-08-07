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
// Capped small on purpose: this is a low-traffic test chatbot talking to a
// Supabase SESSION-mode pooler (port 5432), which caps concurrent sessions
// institution-wide at 15 — pg.Pool defaults to up to 10 connections per
// instance with no limit set, which is far more than this app ever needs
// and eats into that shared ceiling. `idleTimeoutMillis` also releases
// unused connections quickly instead of holding them open indefinitely.
const adapter = new PrismaPg({
  connectionString: env.databaseUrl,
  max: 3,
  idleTimeoutMillis: 10_000,
});

export const prisma = new PrismaClient({ adapter });
