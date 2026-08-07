/**
 * RBAC for the chatbot.
 *
 * This is deliberately NOT a normal Express route middleware — a single
 * POST /chat route serves every intent, and which roles are allowed depends
 * on which intent SBERT just matched, not on the route itself. So this is
 * called directly from src/routes/chat.routes.ts *after* intent detection
 * and *before* any handler in src/services/ runs.
 *
 * The permitted-roles list per intent comes straight from the training
 * dataset's own "roles: student, admin" line for that intent (parsed into
 * src/embeddings/intents.json — see src/training/parse-dataset.ts) — the
 * chatbot never invents its own permission table. If an intent is somehow
 * matched with no roles recorded at all, access defaults to DENIED, never
 * allowed — the whole point of "never rely on the chatbot to decide
 * permissions" is that ambiguity must fail closed.
 */
export function isRoleAllowedForIntent(userRole: string, intentRoles: string[]): boolean {
  if (intentRoles.length === 0) return false;
  return intentRoles.includes(userRole);
}
