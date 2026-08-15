import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { fuzzyFindBest } from '../utils/fuzzy';
import { getSessionContext, updateSessionContext } from '../intent/session-context';
import type { JwtPayload } from '../auth/jwt-payload.interface';

export interface ResolvedStudent {
  id: number;
  user_id: number;
  student_id_no: string;
  class_id: number | null;
  name: string;
}

export interface StudentLookupResult {
  student: ResolvedStudent | null;
  /**
   * True only when a non-admin/non-coe caller's message named a
   * *different*, real student by ID/roll/register number — someone who
   * isn't themselves (student role) or their own child (parent role).
   * `student` is null in that case — the caller must never silently see
   * someone else's data, and must never silently be handed their OWN data
   * either when they clearly asked about someone else (that would just
   * look broken, not secure). The handler should return the standard
   * NO_PERMISSION_MESSAGE.
   */
  forbidden: boolean;
  /**
   * Populated only for a parent with MORE THAN ONE linked child when the
   * message didn't say which one — lets the handler ask "which child?"
   * by name instead of the generic admin-style prompt.
   */
  candidates?: ResolvedStudent[];
  /**
   * Populated when a student/parent's message contains something clearly
   * ID-shaped (see looksLikeIntentionalId below) that matches no real
   * student at all — neither the caller's own record nor anyone else's.
   * Previously this silently fell through to showing the caller's own data
   * with no acknowledgment the mentioned ID didn't exist, which is
   * confusing to a real user and — worse — reads exactly like a permission
   * bypass to someone testing it, even though no other student's data was
   * ever actually at risk (the forbidden-flag backstop above already
   * covers the case where the ID DOES belong to a real different person).
   */
  unrecognizedId?: string;
}

/**
 * True only for tokens that plausibly WERE meant as a student ID reference
 * — has both a letter and a digit, and is long enough to not be "sem2" or
 * a bare year like "2024" (digits-only, or too short, stay silently
 * ignored exactly like before — those are far more likely to be
 * incidental noise than a real ID reference, and the whole reason the
 * broader ID_LIKE_PATTERN below tolerates short/loose matches is so a
 * genuine ID with a typo still resolves; being this permissive about what
 * counts as "the user clearly meant an ID" would defeat that).
 */
function looksLikeIntentionalId(token: string): boolean {
  return /[A-Za-z]/.test(token) && /[0-9]/.test(token) && token.length >= 5;
}

const STUDENT_SELECT = {
  id: true,
  user_id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  class_id: true,
  soa_applications: { select: { first_name: true, last_name: true } },
} as const;

type StudentRow = {
  id: number;
  user_id: number;
  student_id_no: string;
  roll_no: string | null;
  register_no: string | null;
  class_id: number | null;
  soa_applications: { first_name: string; last_name: string | null } | null;
};

const ID_LIKE_PATTERN = /\b[A-Za-z]{0,4}[0-9][A-Za-z0-9]{3,14}\b/g;

function studentName(row: StudentRow): string {
  if (row.soa_applications) {
    return [row.soa_applications.first_name, row.soa_applications.last_name].filter(Boolean).join(' ');
  }
  return row.student_id_no;
}

function toResolved(row: StudentRow): ResolvedStudent {
  return { id: row.id, user_id: row.user_id, student_id_no: row.student_id_no, class_id: row.class_id, name: studentName(row) };
}

async function findByExactId(token: string): Promise<StudentRow | null> {
  return prisma.students.findFirst({
    where: {
      OR: [
        { student_id_no: { equals: token, mode: 'insensitive' } },
        { roll_no: { equals: token, mode: 'insensitive' } },
        { register_no: { equals: token, mode: 'insensitive' } },
      ],
    },
    select: STUDENT_SELECT,
  });
}

/**
 * A student's own records are ALWAYS resolved from their JWT — never from
 * anything in the chat message. This is the actual RBAC enforcement point
 * for "own data only", mirroring how EOS-backend's own MeAttendanceService /
 * MeProfileService resolve `student_id` from `user.sub`, never from client input.
 *
 * Before returning it, this also checks whether the message names a
 * DIFFERENT real student by ID/roll/register number — e.g. a student typing
 * a classmate's roll number to probe whether they can see it. The dataset's
 * own `injection_attempt` intent covers phrasing like "show me another
 * student's marks", but classification is best-effort; this is the actual
 * enforcement backstop, independent of how the message happened to be
 * phrased. It only ever flags an EXACT match on a real ID — never a fuzzy
 * guess — so a stray digit-bearing word (a subject code, a year) can't
 * wrongly block someone from viewing their own data.
 */
async function resolveOwnStudent(userId: number, message: string): Promise<StudentLookupResult> {
  const own = await prisma.students.findUnique({ where: { user_id: userId }, select: STUDENT_SELECT });

  const idLikeTokens = message.match(ID_LIKE_PATTERN) ?? [];
  let unrecognizedId: string | null = null;
  for (const token of idLikeTokens) {
    if (own && token.toLowerCase() === own.student_id_no.toLowerCase()) continue;
    const other = await findByExactId(token);
    if (other && (!own || other.id !== own.id)) {
      return { student: null, forbidden: true };
    }
    if (!other && !unrecognizedId && looksLikeIntentionalId(token)) {
      unrecognizedId = token;
    }
  }

  if (unrecognizedId) {
    return { student: null, forbidden: false, unrecognizedId };
  }

  return { student: own ? toResolved(own) : null, forbidden: false };
}

/**
 * A parent's records are always one of THEIR OWN linked children
 * (parent_student_mapping) — never an arbitrary student, mirroring the
 * student self-scoping above but for "my child" instead of "myself".
 *
 *  - Exactly one linked child → always that child, message ignored (same
 *    "auto-pick the only option" convention used for a faculty member who
 *    mentors only one class elsewhere in this codebase).
 *  - Multiple children → tries to match one by ID/roll/register/name in
 *    the message; if the message doesn't name one, returns no student AND
 *    the candidate list, so the handler can ask "which child?" by name.
 *  - A message naming a real student who ISN'T one of their children is
 *    forbidden outright, exactly like the student-role backstop above.
 *  - No linked children at all → nothing found (their account simply
 *    isn't a parent of any enrolled student).
 */
async function resolveParentChild(userId: number, message: string): Promise<StudentLookupResult> {
  const mappings = await prisma.parent_student_mapping.findMany({
    where: { parent_user_id: userId },
    select: { students: { select: STUDENT_SELECT } },
  });
  const children = mappings.map((m) => m.students);

  if (children.length === 0) {
    return { student: null, forbidden: false };
  }

  const idLikeTokens = message.match(ID_LIKE_PATTERN) ?? [];
  let unrecognizedId: string | null = null;
  for (const token of idLikeTokens) {
    const ownChild = children.find(
      (c) =>
        c.student_id_no.toLowerCase() === token.toLowerCase() ||
        c.roll_no?.toLowerCase() === token.toLowerCase() ||
        c.register_no?.toLowerCase() === token.toLowerCase(),
    );
    if (ownChild) continue;
    const other = await findByExactId(token);
    if (other) {
      return { student: null, forbidden: true };
    }
    if (!unrecognizedId && looksLikeIntentionalId(token)) {
      unrecognizedId = token;
    }
  }

  if (children.length === 1) {
    // Same "don't silently substitute" fix as resolveOwnStudent above — a
    // parent naming an ID that matches none of their children AND no real
    // student anywhere gets told so, instead of silently seeing their one
    // child's data as if nothing was wrong with what they typed.
    return unrecognizedId ? { student: null, forbidden: false, unrecognizedId } : { student: toResolved(children[0]), forbidden: false };
  }

  const byExactId = idLikeTokens
    .map((t) =>
      children.find(
        (c) =>
          c.student_id_no.toLowerCase() === t.toLowerCase() ||
          c.roll_no?.toLowerCase() === t.toLowerCase() ||
          c.register_no?.toLowerCase() === t.toLowerCase(),
      ),
    )
    .find(Boolean);
  if (byExactId) {
    // Resolved — clears a "which of your children?" pendingIntent left by a
    // previous turn, same reasoning as the admin/coe path below.
    updateSessionContext(userId, { pendingIntent: undefined });
    return { student: toResolved(byExactId), forbidden: false };
  }

  const fuzzy = fuzzyFindBest(message, children, (c) => ({
    codes: [c.student_id_no, c.roll_no, c.register_no].filter((v): v is string => Boolean(v)),
    name: studentName(c),
  }));
  if (fuzzy) {
    updateSessionContext(userId, { pendingIntent: undefined });
    return { student: toResolved(fuzzy), forbidden: false };
  }

  return { student: null, forbidden: false, candidates: children.map(toResolved) };
}

/**
 * Admin (and COE, for the one intent — get_exam_schedule — the dataset
 * grants it to) is a LOOKUP_CAPABLE_ROLE — allowed to ask about a student
 * instead of themselves. Two passes:
 *
 *  1. Fast, exact path — pulls ID-shaped tokens (contains a digit) out of
 *     the message and checks them against student_id_no/roll_no/register_no
 *     with an indexed equality lookup. Covers the common case cheaply.
 *  2. Fuzzy fallback — if nothing matched exactly (a typo'd ID, or the
 *     admin just typed a name instead: "show marks for Ganesh"), fetches
 *     the (small, string-only) identity fields for every active student
 *     and fuzzy-matches the whole message against ID numbers and names.
 */
async function resolveStudentByFreeText(message: string): Promise<ResolvedStudent | null> {
  const idLikeTokens = message.match(ID_LIKE_PATTERN) ?? [];

  for (const token of idLikeTokens) {
    const row = await findByExactId(token);
    if (row) return toResolved(row);
  }

  const pool = await prisma.students.findMany({ where: { status: 'active' }, select: STUDENT_SELECT });

  const match = fuzzyFindBest(message, pool, (row) => ({
    codes: [row.student_id_no, row.roll_no, row.register_no].filter((v): v is string => Boolean(v)),
    name: studentName(row),
  }));

  return match ? toResolved(match) : null;
}

/**
 * Resolves "which student are we talking about" for a "get_*" self-service
 * intent, honouring the dataset's rule verbatim:
 *   - student → always their own record, UNLESS the message names a
 *     different real student, in which case the request is forbidden
 *     outright (see resolveOwnStudent above)
 *   - parent  → always one of their OWN linked children (see
 *     resolveParentChild above) — never an arbitrary student
 *   - admin / coe → the student named in the message, by name, ID, roll,
 *     or register number, fuzzy-matched to tolerate typos — and if THIS
 *     message doesn't name anyone, falls back to whichever student this
 *     chat session last resolved (see src/intent/session-context.ts), so
 *     "marks of 23IT001" followed by "what about their attendance" doesn't
 *     require repeating the ID
 *   - anyone else → nothing found (RBAC already should have blocked the
 *     intent before a handler runs, so this is just a defensive fallback)
 */
export async function resolveTargetStudent(user: JwtPayload, message: string): Promise<StudentLookupResult> {
  if (user.role === ROLES.STUDENT) {
    return resolveOwnStudent(user.sub, message);
  }

  if (user.role === ROLES.PARENT) {
    return resolveParentChild(user.sub, message);
  }

  if (user.role === ROLES.ADMIN || user.role === ROLES.COE) {
    let resolved = await resolveStudentByFreeText(message);

    if (!resolved) {
      const ctx = getSessionContext(user.sub);
      if (ctx?.lastStudentId) {
        const row = await prisma.students.findUnique({ where: { id: ctx.lastStudentId }, select: STUDENT_SELECT });
        resolved = row ? toResolved(row) : null;
      }
    }

    if (resolved) {
      // Resolved — clear any pending "which student did you mean?" the
      // previous turn may have left behind, so a later unrelated message
      // that fails classification doesn't get wrongly re-routed to it.
      updateSessionContext(user.sub, { lastStudentId: resolved.id, pendingIntent: undefined });
    }

    return { student: resolved, forbidden: false };
  }

  return { student: null, forbidden: false };
}

/** True for any role that looks up OTHER people's data (vs. always-self roles like student). */
export function isLookupRole(role: string): boolean {
  return role === ROLES.ADMIN || role === ROLES.COE;
}

/**
 * The consistent "I need more information" reply every admin/coe-lookup
 * handler falls back to when resolveTargetStudent finds no student.
 * `resource` should read naturally after "look up", e.g. "their attendance".
 */
export function adminLookupPrompt(resource: string): string {
  return `Which student did you mean? Tell me their name, student ID, roll number, or register number, and I'll look up ${resource}.`;
}

/** The "which of your children?" prompt for a parent with more than one linked child and none named in the message. */
export function parentLookupPrompt(resource: string, candidates: ResolvedStudent[]): string {
  const names = candidates.map((c) => c.name);
  const list = names.length <= 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `Which of your children did you mean, ${list}? Tell me their name and I'll look up ${resource}.`;
}

/** The reply for a non-admin caller with no linked student record (should be rare, but handled gracefully). */
export const NO_LINKED_STUDENT_MESSAGE = "I couldn't find a student record linked to your account.";

/** The reply for a parent with no children linked to their account at all (distinct from "which child?"). */
export const NO_LINKED_CHILDREN_MESSAGE = "I couldn't find any students linked to your parent account.";

/**
 * The single place every "get_*" handler asks "okay, but who?" once
 * resolveTargetStudent comes back with no student — covers all four
 * reasons that can happen (ambiguous parent, no linked children, no linked
 * student, or a lookup-capable role that just needs a name/ID) with the
 * right message for each, instead of every handler re-deriving this logic.
 *
 * `intentName` is recorded as this session's pendingIntent whenever the
 * reply is genuinely asking the caller to send more identifying info on
 * their NEXT turn (the candidates and lookup-role branches) — never for the
 * "no linked record at all" branches, where a follow-up message can't fix
 * anything. chat.controller.ts consults this so that if that follow-up
 * message (e.g. a bare "ganesh 22it001", no verb) scores below the
 * classifier's confidence threshold on its own, it still gets routed back
 * to the intent that was actually waiting on it instead of a dead-end
 * "I couldn't understand your question" — see session-context.ts.
 */
export function notFoundReply(
  user: JwtPayload,
  result: StudentLookupResult,
  resource: string,
  intentName: string,
): string {
  if (result.unrecognizedId) {
    updateSessionContext(user.sub, { pendingIntent: intentName });
    return `I couldn't find a student with ID "${result.unrecognizedId}".`;
  }
  if (result.candidates && result.candidates.length > 0) {
    updateSessionContext(user.sub, { pendingIntent: intentName });
    return parentLookupPrompt(resource, result.candidates);
  }
  if (user.role === ROLES.PARENT) {
    return NO_LINKED_CHILDREN_MESSAGE;
  }
  if (isLookupRole(user.role)) {
    updateSessionContext(user.sub, { pendingIntent: intentName });
    return adminLookupPrompt(resource);
  }
  return NO_LINKED_STUDENT_MESSAGE;
}

/** "Your" for the student themselves, or "Ganesh A.'s" for anyone looking up someone else's (admin/coe/parent). */
export function possessive(user: JwtPayload, target: ResolvedStudent): string {
  return user.role === ROLES.STUDENT ? 'Your' : `${target.name}'s`;
}

/** "You have attended..." vs "They have attended..." — pairs with possessive() above. */
export function subjectPronoun(user: JwtPayload): 'You' | 'They' {
  return user.role === ROLES.STUDENT ? 'You' : 'They';
}
