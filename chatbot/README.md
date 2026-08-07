# EOS Chatbot

A conversational backend for the EOS ERP system. It understands a question in
plain English, detects intent completely offline with Sentence-BERT
(`all-MiniLM-L6-v2`), checks the caller's role, fetches the answer from the
**existing EOS database**, and replies in plain English.

No LLM. No external AI API. No API key. Works fully offline after one-time
model download. No new database tables, no new users, no duplicated business
logic — see [Architecture](#architecture) for exactly what's reused vs. new.

```
User question
   → SBERT embedding (all-MiniLM-L6-v2, in-process, offline)
   → cosine similarity against 2,047 trained examples across 84 intents
   → best match below confidence threshold? → "I couldn't understand your
     question. Please rephrase it."
   → RBAC check against the intent's allowed roles (from the training
     dataset itself) → not allowed? → "Sorry, you don't have permission
     to access this information."
   → intent handler reads the shared EOS Postgres database (read-only)
   → conversational reply
```

## Architecture

**This is a separate Node/Express service, not a fork of EOS-backend.** It
connects to the **same PostgreSQL database** as EOS-backend, using a
generated Prisma Client built from a verbatim copy of
`EOS-backend/prisma/schema.prisma` (see [`prisma/schema.prisma`](prisma/schema.prisma) —
one intentional one-line patch, explained [below](#one-schema-patch)). No
table, column, or enum was added, renamed, or removed.

**Every data-fetching handler in `src/services/` is read-only.** There is no
`.create(`, `.update(`, `.delete(`, or `.upsert(` against the shared database
anywhere in this codebase — every mutation flow (marking attendance,
entering marks, approving leave, collecting a fee payment, etc.) stays
exactly where it already lives, in EOS-backend. The chatbot only ever
answers questions; it never changes ERP data.

**RBAC is never decided by the chatbot's "judgement."** The allowed roles
for every intent come straight from the training dataset's own
`roles: student, admin` line for that intent (parsed into
`src/embeddings/intents.json` — see `src/training/parse-dataset.ts`).
`src/middleware/rbac.middleware.ts` just looks that list up and denies by
default if it's empty or the caller's role isn't in it. Every data handler
additionally re-derives *whose* data to show from the JWT (`user.sub`), not
from anything in the chat message — see `src/services/student-lookup.util.ts`
for the one exception the dataset itself calls out: **admin** may look up a
student by ID/roll/register number found in the message (`LOOKUP_CAPABLE_ROLES
= {admin}` per the dataset's own intro), every other role is locked to itself.

### Why direct database reuse instead of calling the backend's HTTP API

Most of EOS-backend's endpoints ARE properly role-scoped self-service routes
(`GET /me/attendance`, `GET /me/timetable`, `GET /announcements`, etc.) and
this chatbot's query patterns deliberately mirror them field-for-field. But
three of the intents the brief explicitly asks for (`get_marks`, `get_fees`,
`get_exam_schedule`) have **no route a student or faculty JWT can call today**
— see [Known backend gaps](#known-backend-gaps-this-chatbot-works-around).
Rather than either (a) silently giving students access data via an
admin-only route, or (b) leaving those three intents unimplemented, this
service reads the same database directly, applying the exact same
self-scoping rule a real self-service endpoint would (see the "mirrors
EOS-backend's ...Service exactly" comments in `src/services/announcements.service.ts`
and `src/services/attendance.service.ts` for the two cases where a real
endpoint's scoping logic is being deliberately reproduced, not invented).

### Known backend gaps this chatbot works around

| Intent | What EOS-backend has today | What this chatbot does |
|---|---|---|
| `get_marks` | `GET /exam-marks` has **no auth guard on GET at all**; `GET /me/exam-marks` only returns marks a faculty *entered themselves* | Reads `exam_marks` directly, scoped to the caller's own `student_id` (or admin's looked-up target), and — matching the dataset's own description — only `results_published` exams for students |
| `get_fees` | Every fee-billing route is `@Roles(ADMIN)`-only, no student-facing route exists | Reads `student_fee_demand_mapping` + `fee_payments` directly, scoped the same way |
| `get_exam_schedule` | `exam-timetable` module is `@Roles(COE)`-only for every route, including GET | Reads `exam_timetable` directly, scoped to the target student's class, and — matching the dataset's description — only published entries for students |

**Recommendation for the backend team:** once `GET /me/marks`,
`GET /me/fees`, and `GET /me/exam-timetable` exist with proper RBAC, swap
these three handlers to call them over HTTP instead (same pattern as
`src/services/timetable.service.ts` already follows conceptually) and delete
the direct-Prisma queries. Nothing else needs to change.

### One schema patch

`EOS-backend/prisma/schema.prisma` (as of this chatbot's `prisma/schema.prisma`
copy) fails `prisma generate` validation as-is: the `e_resources.users`
relation has no opposite field declared on the `users` model. This is a
pre-existing bug in the backend's schema file, not something this project
introduced — confirmed by running `prisma generate` against the untouched
backend checkout. `prisma/schema.prisma` here has ONE line added (an
`e_resources e_resources[]` back-relation on `model users`) purely so the
Prisma Client can be generated; **no table/column/enum changed**. Worth
fixing upstream in EOS-backend too.

## Project structure

```
chatbot/
├── src/
│   ├── auth/           TEMPORARY login — see src/auth/README.md before touching
│   ├── middleware/      verifyJwt (auth), rbac (permission check), error handler
│   ├── intent/          SBERT embedder, classifier, intent→handler registry, types
│   ├── training/        one-time scripts: docx → intents.json → embeddings.json
│   ├── embeddings/      generated artifacts (gitignored, rebuild with `npm run train`)
│   ├── services/        one file per intent domain — the only code that reads the DB
│   ├── routes/          POST /chat wiring
│   ├── utils/           prisma client, password hashing, logger, response helpers
│   ├── config/          env, role constants
│   ├── app.ts / server.ts
│   └── generated/prisma/  Prisma Client (generated, gitignored)
├── prisma/schema.prisma  verbatim copy of EOS-backend's schema (+1 line, see above)
├── scripts/smoke-test-intents.ts   offline classifier sanity check, no DB needed
└── .transformers-cache/  cached SBERT ONNX weights (gitignored)
```

## Setup

### 1. Install & configure

```bash
npm install
cp .env.example .env
```

Edit `.env`:

- `DATABASE_URL` — **the exact same value as `EOS-backend/.env`'s `DATABASE_URL`.**
  This chatbot reads the same database; it does not need its own.

  **If your database is Supabase behind a pooler, prefer the transaction-mode
  pooler port (`:6543`) over the session-mode port (`:5432`).** This app opens
  and closes a lot of short-lived connections (every restart during
  development, every `/chat` request in production) — session mode holds one
  dedicated session per client for its entire lifetime and caps total
  concurrent sessions institution-wide (Supabase's default is 15), so a few
  ungraceful restarts in a row can exhaust it with a confusing
  `EMAXCONNSESSION` error. Transaction mode releases the connection back to
  the pool after each query and doesn't have this failure mode. `src/utils/prisma.ts`
  also caps this app's own pool (`max: 3`) and `src/server.ts` disconnects
  cleanly on `SIGINT`/`SIGTERM` — but a hard `kill -9` / force-stop skips
  that, so the pooler-mode choice is the real fix, not just cleanup on our side.
- `CHATBOT_JWT_SECRET` — any long random string. Independent of EOS-backend's
  `JWT_SECRET` on purpose (see `src/auth/README.md`).
- `INTENT_CONFIDENCE_THRESHOLD` — default `0.55`, tune after reviewing real traffic.

### 2. Generate the Prisma Client

```bash
npm run prisma:generate
```

### 3. Train the SBERT intent classifier

```bash
npm run train
```

This runs two steps (`train:parse` then `train:embed`):
1. Parses `EOS_Intent_Training_Dataset_English_Only.docx` (expected one
   directory above `chatbot/` by default — pass an explicit path:
   `npx tsx src/training/parse-dataset.ts <path>`) into `src/embeddings/intents.json`.
2. Embeds all 2,047 example utterances with SBERT into `src/embeddings/embeddings.json`.

**First run downloads ~90MB of ONNX model weights** from the Hugging Face
hub and caches them under `.transformers-cache/`. Every run after that —
including every `/chat` request at runtime — is fully offline against the
local cache. For a fully air-gapped environment, run `npm run train` once
somewhere with internet, then copy `.transformers-cache/` alongside the
rest of the deployment.

Re-run `npm run train` any time the `.docx` dataset changes.

### 4. Run it

```bash
npm run dev     # tsx watch, for development
# or
npm run build && npm start   # compiled, for production
```

```
🤖 EOS Chatbot running on http://localhost:4000
   POST /auth/login  — temporary login (see src/auth/README.md)
   POST /chat        — ask a question (Bearer token required)
```

### Try it in the browser

Open **http://localhost:4000/** — a minimal test UI (`public/index.html`,
plain HTML/CSS/JS, no build step, no external dependencies) is served
directly by the same Express app. Log in with any active EOS user's
email/password and chat. Each bot reply shows the matched intent and
confidence, and flags RBAC denials, so it doubles as a quick way to see the
classifier and permission checks working without curl.

## API

### `POST /auth/login` — temporary, see [`src/auth/README.md`](src/auth/README.md)

```json
// request
{ "email": "student@example.edu", "password": "••••••••" }

// response
{
  "success": true,
  "accessToken": "eyJ...",
  "user": { "id": 42, "name": "Priya Sharma", "email": "...", "role": "student", "roleId": 4 }
}
```

### `POST /chat` — requires `Authorization: Bearer <accessToken>`

```json
// request
{ "message": "Show my attendance" }

// response
{
  "reply": "Your current attendance is 91%. You have attended 82 out of 90 classes.",
  "intent": "get_attendance",
  "confidence": 0.93,
  "data": { "total": 90, "present": 82, "percentage": 91 }
}
```

Denied and low-confidence cases still return `200` with a conversational
`reply` (this is a chat turn, not a REST resource) — only malformed requests
(missing `message`) or genuine server errors use the shared error envelope
(`success: false`, `errorCode`, ...).

### `GET /health`

```json
{ "status": "ok", "service": "eos-chatbot" }
```

## Intent coverage

The classifier is trained on **84 intents / 2,047 examples** — the
original 80-intent dataset plus a second pass (`scripts/augment-dataset-2.ts`)
that merged in a user-supplied generic pattern sheet: phrasings that
duplicated existing intents were added as more training examples, and four
genuinely new intents (`password_reset`, `general_facilities`,
`admissions_info`, `library_hours`) were appended under their own "General"
section. `scripts/augment-dataset.ts` similarly added ID/roll-number-centric
admin-lookup phrasing ("marks of 23IT001") after live testing found that
gap. Both scripts back up the original `.docx` to `.docx.bak` before writing.
Real backend integration is wired up for a curated set covering every role
and several ERP modules (see `src/intent/intent.registry.ts`):

- **Student self-service** (also admin, via register-number lookup):
  `get_profile`, `get_attendance`, `get_timetable`, `get_marks`, `get_fees`,
  `get_exam_schedule`, `get_announcements`, `get_my_subjects`, `get_mentor`,
  `get_holidays`
- **Universal**: `library_hours`
- **Faculty**: `faculty_my_classes`, `faculty_class_attendance`, `section_students`
- **Admin**: `admin_list_students`, `admin_list_faculty`
- **Utility / safety** (no DB access): `greeting`, `help`, `thanks`, `goodbye`,
  `bot_identity`, `wrong_answer`, `human_handoff`, `feedback_positive`,
  `abuse`, `injection_attempt`, `emergency_or_distress`
- **Out of scope**: `out_of_scope` + all `oos_*` intents (CGPA, mess menu,
  WiFi, syllabus, faculty contact, payment actions)
- **Real need, no backing data — honest redirect**: `password_reset`,
  `general_facilities`, `admissions_info` (distinct from `admin_admission_status`,
  which checks an *existing* application's status for admin)

Every other recognised intent (hostel, transport, library, placement,
procurement, venues, visitor logs, appraisal, payroll, invigilation, ...)
still gets classified correctly — it just replies honestly that it isn't
connected yet (`src/services/utility.service.ts` → `notWiredUp`), instead of
silently doing nothing or guessing.

**To wire up a new intent:** write a handler in `src/services/`
(`(ctx: HandlerContext) => Promise<ChatReply>`), import it in
`src/intent/intent.registry.ts`, add one line to `INTENT_HANDLERS`. RBAC is
already enforced before your handler ever runs — just read `ctx.user` and
`ctx.message`.

## Testing without a live database

```bash
npx tsx scripts/smoke-test-intents.ts
```

Exercises the SBERT classifier against known phrasings, typo variants, and
paraphrases across student/utility/out-of-scope categories — no database
required, since intent detection never touches Prisma.

To test the full pipeline (auth → RBAC → DB-backed reply) end to end, point
`DATABASE_URL` at a real (or local copy of the) EOS database, seed at least
one `active` user per role via EOS-backend's own `prisma/seed.ts`, then:

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<seeded-student-email>","password":"<password>"}'

curl -X POST http://localhost:4000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"message":"Show my attendance"}'
```

With no database reachable, every non-DB path (health check, JWT
verification, RBAC denial, low-confidence fallback, all utility intents)
still works correctly and the server never crashes — DB-backed handlers
fail with a normal `500 INTERNAL_ERROR` instead, logged with the real
Prisma error. This was verified during development; see git history / PR
description for the exact request/response pairs exercised.

## Removing the temporary login

See [`src/auth/README.md`](src/auth/README.md) — it's a self-contained
module by design. Delete `src/auth/` and
`src/middleware/verifyJwt.middleware.ts`, plug in the real ERP session
verification with the same `{ sub, name, role, roleId, email }` shape, done.
