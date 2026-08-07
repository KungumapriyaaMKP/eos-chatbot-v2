# Temporary chatbot auth — read this before deleting

Everything in this folder exists **only** so the chatbot can be tested on
its own, before the real EOS ERP frontend is wired up to send its own
session token on every request.

## What it does

- `POST /auth/login` takes `{ email, password }`, looks them up against the
  **existing** `users` + `roles` tables in the shared EOS database (via
  `src/utils/prisma.ts`), and checks the password with the exact same
  `sha256(password) === password_hash` scheme EOS-backend's own
  `AuthService` uses (`src/utils/password.ts`). No new user, no new table,
  no new credential store — this reads data that already exists.
- On success it mints a **chatbot-scoped** JWT (`CHATBOT_JWT_SECRET`, a
  different secret from the backend's `JWT_SECRET`) containing at least
  `{ sub: userId, name, role }`, per the brief's requirement.
- `src/middleware/verifyJwt.middleware.ts` verifies that token on every
  `/chat` request and attaches `req.user`.

## Why it's isolated like this

Nothing outside `src/auth/` and `src/middleware/verifyJwt.middleware.ts`
knows or cares how `req.user` was populated. Every intent handler in
`src/services/` only ever reads `req.user.sub` / `req.user.role` / etc.

## How to remove it once the real ERP login is ready

1. Delete `src/auth/` entirely.
2. Delete `src/middleware/verifyJwt.middleware.ts`.
3. Write a new middleware that verifies the ERP's real session/JWT and
   attaches the same shape to `req.user`:
   ```ts
   { sub: number; name: string; role: string; roleId: number; email: string }
   ```
4. Swap the import in `src/app.ts` (`authRouter` mount + the middleware used
   in `src/routes/chat.routes.ts`) for the new one.

No other file changes. RBAC (`src/middleware/rbac.middleware.ts`), intent
detection, and every service handler are unaffected because they only ever
depend on the `req.user` shape, never on how it got there.
