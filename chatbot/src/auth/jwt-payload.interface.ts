/**
 * The chatbot's own JWT payload — issued by src/auth (temporary login),
 * verified by src/middleware/verifyJwt.middleware.ts on every /chat request.
 *
 * Per the brief: "generate a JWT containing at least: User ID, Name, Role" —
 * `sub`/`name`/`role` satisfy that. `roleId` and `email` are carried along
 * because several service handlers need them and re-deriving them from the
 * DB on every chat turn would be wasteful.
 */
export interface JwtPayload {
  /** users.id */
  sub: number;
  name: string;
  /** role name from the `roles` table (e.g. 'student', 'faculty', 'admin') */
  role: string;
  roleId: number;
  email: string;
}
