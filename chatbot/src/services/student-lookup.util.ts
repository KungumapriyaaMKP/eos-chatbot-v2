import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { fuzzyFindBest } from '../utils/fuzzy';
import type { JwtPayload } from '../auth/jwt-payload.interface';

export interface ResolvedStudent {
  id: number;
  student_id_no: string;
  class_id: number | null;
  name: string;
}

export interface StudentLookupResult {
  student: ResolvedStudent | null;
  /**
   * True only when a non-admin caller's message named a *different*, real
   * student by ID/roll/register number. `student` is null in that case —
   * the caller must never silently see someone else's data, and must never
   * silently be handed their OWN data either when they clearly asked about
   * someone else (that would just look broken, not secure). The handler
   * should return the standard NO_PERMISSION_MESSAGE.
   */
  forbidden: boolean;
}

const STUDENT_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  class_id: true,
  soa_applications: { select: { first_name: true, last_name: true } },
} as const;

type StudentRow = {
  id: number;
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
  return { id: row.id, student_id_no: row.student_id_no, class_id: row.class_id, name: studentName(row) };
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
  for (const token of idLikeTokens) {
    if (own && token.toLowerCase() === own.student_id_no.toLowerCase()) continue;
    const other = await findByExactId(token);
    if (other && (!own || other.id !== own.id)) {
      return { student: null, forbidden: true };
    }
  }

  return { student: own ? toResolved(own) : null, forbidden: false };
}

/**
 * Admin is the dataset's one LOOKUP_CAPABLE_ROLE — the only role allowed to
 * ask about a student instead of themselves. Two passes:
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
 *   - admin   → the student named in the message, by name, ID, roll, or
 *     register number, fuzzy-matched to tolerate typos
 *   - anyone else → nothing found (RBAC already should have blocked the
 *     intent before a handler runs, so this is just a defensive fallback)
 */
export async function resolveTargetStudent(user: JwtPayload, message: string): Promise<StudentLookupResult> {
  if (user.role === ROLES.STUDENT) {
    return resolveOwnStudent(user.sub, message);
  }
  if (user.role === ROLES.ADMIN) {
    return { student: await resolveStudentByFreeText(message), forbidden: false };
  }
  return { student: null, forbidden: false };
}

/**
 * The consistent "I need more information" reply every admin-lookup handler
 * falls back to when resolveTargetStudent finds no student and the caller
 * is admin. `resource` should read naturally after "look up", e.g.
 * "their attendance", "their fee status".
 */
export function adminLookupPrompt(resource: string): string {
  return `Which student did you mean? Tell me their name, student ID, roll number, or register number, and I'll look up ${resource}.`;
}

/** The reply for a non-admin caller with no linked student record (should be rare, but handled gracefully). */
export const NO_LINKED_STUDENT_MESSAGE = "I couldn't find a student record linked to your account.";
