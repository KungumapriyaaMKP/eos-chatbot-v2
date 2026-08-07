/** One intent block parsed out of the training dataset (see src/training/parse-dataset.ts). */
export interface IntentDefinition {
  /** e.g. "get_marks" — matches the dataset's Heading2 text verbatim. */
  name: string;
  /** e.g. "Student - exams" — the dataset's Heading1 grouping. */
  module: string;
  /** Canonical backend role strings this intent is permitted for, e.g. ['student', 'admin']. */
  roles: string[];
  description: string;
  examples: string[];
}

export interface IntentDataset {
  generatedAt: string;
  sourceFile: string;
  totalIntents: number;
  totalExamples: number;
  intents: IntentDefinition[];
}

/** One embedded training example, used for nearest-neighbour intent matching. */
export interface EmbeddedExample {
  intent: string;
  text: string;
  /** L2-normalized SBERT sentence embedding. */
  vector: number[];
}

export interface EmbeddingsFile {
  model: string;
  dim: number;
  generatedAt: string;
  examples: EmbeddedExample[];
}

export interface IntentMatch {
  intent: string | null;
  confidence: number;
  matchedExample: string | null;
  roles: string[];
  module: string | null;
}

export interface HandlerContext {
  user: import('../auth/jwt-payload.interface').JwtPayload;
  message: string;
  match: IntentMatch;
}

/**
 * One intent-to-service handler (src/services/*). Given the authenticated
 * user + the matched intent, calls the appropriate read-only Prisma query
 * (reusing the exact scoping rules EOS-backend's own services already use)
 * and returns a conversational reply. Handlers never re-check RBAC
 * themselves — src/middleware/rbac.middleware.ts already gated the call
 * before a handler is ever invoked.
 */
export type IntentHandler = (
  ctx: HandlerContext,
) => Promise<import('../utils/response').ChatReply>;
