/**
 * Lightweight, rule-based conversation memory — NOT an LLM, just a small
 * in-memory record of "who/what was this chat session just talking about"
 * so a follow-up message that omits the identifier still resolves
 * correctly. E.g.:
 *
 *   admin> marks of 23IT001
 *   bot>   [Lakshmi's marks]
 *   admin> what about their attendance          <- no ID mentioned this time
 *   bot>   [Lakshmi's attendance]                <- still resolves correctly
 *
 * Scope and honest limitations (all deliberate trade-offs for a temporary
 * test chatbot, not oversights):
 *  - Keyed by user id (JWT `sub`), not a separate per-tab session token —
 *    two browser tabs logged in as the same admin share one memory. Good
 *    enough for "remember this conversation", not strict tab isolation.
 *  - In-memory only (a plain Map) — lost on server restart, doesn't scale
 *    past one Node process. Matches this app's existing "no new tables"
 *    constraint and its temporary, single-instance nature.
 *  - Expires after 30 minutes of inactivity so a stale student/class from
 *    an hour-old conversation can never silently leak into a new one.
 */

export interface SessionContext {
  lastStudentId?: number;
  lastClassId?: number;
  updatedAt: number;
}

const TTL_MS = 30 * 60 * 1000;

const store = new Map<number, SessionContext>();

export function getSessionContext(userId: number): SessionContext | null {
  const ctx = store.get(userId);
  if (!ctx) return null;
  if (Date.now() - ctx.updatedAt > TTL_MS) {
    store.delete(userId);
    return null;
  }
  return ctx;
}

export function updateSessionContext(userId: number, patch: Omit<SessionContext, 'updatedAt'>): void {
  const existing = store.get(userId);
  store.set(userId, { ...existing, ...patch, updatedAt: Date.now() });
}
