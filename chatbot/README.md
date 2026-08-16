# EOS Chatbot

A conversational backend for the EOS ERP system. It understands a question in
plain English, detects intent completely offline with Sentence-BERT
(`paraphrase-multilingual-MiniLM-L12-v2`), checks the caller's role, fetches
the answer from the **existing EOS database**, and replies in plain English.

No external AI API, no API key, no data ever leaves the machine. A local
LLM (Llama 3.2 3B via [Ollama](https://ollama.com)) is used for two narrow,
fact-checked, fully-offline jobs — confidence-gated intent reranking and
reply paraphrasing — never to originate a fact; both are optional and fall
back safely if Ollama isn't running. See [LLM-assisted
reranking/paraphrasing](#llm-assisted-reranking-and-paraphrasing) below. No
new EOS/ERP data tables, no new users, no duplicated business logic — see
[Architecture](#architecture) for exactly what's reused vs. new (the
chatbot does own 3 small tables of its own for query logging/analytics,
see [Learning pipeline](#learning-pipeline)).

```
User question
   → SBERT embedding (multilingual MiniLM-L12, in-process, offline)
   → cosine similarity against 2,568 trained examples across 95 intents
   → best match below confidence threshold? → "I couldn't understand your
     question. Please rephrase it."
   → (low-confidence only) confidence-gated LLM reranking via local Ollama
   → RBAC check against the intent's allowed roles (from the training
     dataset itself) → not allowed? → "Sorry, you don't have permission
     to access this information."
   → intent handler reads the shared EOS Postgres database (read-only)
   → reply paraphrased for natural phrasing (fact-verified, local Ollama)
   → conversational reply
```

## Architecture

**This is a separate Node/Express service, not a fork of EOS-backend.** It
connects to the **same PostgreSQL database** as EOS-backend, using a
generated Prisma Client built from a verbatim copy of
`EOS-backend/prisma/schema.prisma` (see [`prisma/schema.prisma`](prisma/schema.prisma) —
one intentional one-line patch, explained [below](#one-schema-patch)). No
table, column, or enum was added, renamed, or removed.

**Every data-fetching handler in `src/services/` is read-only against the
shared EOS/ERP data.** There is no `.create(`, `.update(`, `.delete(`, or
`.upsert(` against any EXISTING EOS-backend table anywhere in this
codebase — every mutation flow (marking attendance, entering marks,
approving leave, collecting a fee payment, etc.) stays exactly where it
already lives, in EOS-backend. The chatbot never changes ERP data. (It DOES
write to 3 small tables it owns itself — see [Learning
pipeline](#learning-pipeline) — but those aren't EOS/ERP data, they're the
chatbot's own query-logging/analytics tables.)

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

### Known EOS-backend security issues (not fixed here — different repo)

Found while studying the backend to build this chatbot. Deliberately **not
patched** — `EOS-backend` is a separate repository this project only reads
from, and fixing it wasn't part of this engagement. Flagging both clearly so
they don't get lost:

1. **`GET /exam-marks` has no authentication guard at all.**
   `src/modules/exams/marks/marks.controller.ts` — the `@Post`/`@Patch`/`@Delete`
   handlers are `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(ROLES.FACULTY)`,
   but `@Get()` and `@Get(':id')` have **no guards at all**. Anyone who can
   reach the server — no token, no login — can call this endpoint and read
   every student's every mark. (This chatbot never calls that route; it
   reads `exam_marks` directly via Prisma with its own RBAC in front of it —
   see the table above.) **Fix:** add `@UseGuards(JwtAuthGuard, RolesGuard)`
   to the controller class or those two handlers specifically, matching every
   other read-sensitive endpoint in the codebase.

2. **Passwords are hashed with unsalted SHA-256**, not a proper password
   hash. `src/auth/auth.service.ts`: `crypto.createHash('sha256').update(dto.password).digest('hex')`,
   compared directly against `users.password_hash`. SHA-256 is a fast,
   general-purpose hash — designed to be computed quickly, which is exactly
   the wrong property for a password hash. No salt means two users with the
   same password get the identical `password_hash` value, and the whole
   `users` table is one rainbow-table lookup away from mass-cracking if it's
   ever exposed. (This chatbot's own temporary login in `src/auth/` replicates
   this exact scheme deliberately, purely for compatibility with the existing
   `password_hash` column — see `src/utils/password.ts`'s comment. If the
   backend's scheme changes, that file needs to change with it.) **Fix:**
   migrate to `bcrypt`/`argon2` with a per-user salt (Node has `bcrypt`/
   `argon2` packages for this); requires a migration path for existing
   `password_hash` values (e.g. rehash on next successful login).

### Schema patches (local copy only — the live database was never touched)

`EOS-backend/prisma/schema.prisma`, as checked into that repo, doesn't
fully match either Prisma's own validation rules or the actual deployed
database. Neither issue was introduced by this project — both were found
while building it and are patched **only** in this chatbot's own
`prisma/schema.prisma` copy, purely so `prisma generate` succeeds and reads
line up with real columns:

1. **`e_resources.users` relation has no opposite field** on `model users`
   — fails `prisma generate` validation as-is (confirmed against the
   untouched backend checkout). Fixed with one added line
   (`e_resources e_resources[]` on `model users`).
2. **The live database has drifted from the checked-in schema** — e.g.
   `exam_timetable.is_published` is declared in the schema but doesn't
   exist on the real table at all (confirmed via `information_schema`);
   the actual publish flag turned out to live one join up, on
   `exam_subject_mapping.is_published`/`published_at`/`is_elective`, which
   also aren't in the checked-in schema. Added those three fields to this
   copy so `get_exam_schedule` (`src/services/exam-schedule.service.ts`)
   can filter on the real column instead of a nonexistent one. Several
   other tables have live columns beyond what the checked-in schema
   declares too (faculty has ~30 extra fields, for one) — none of those
   are used by this chatbot, so they weren't added here, but it's worth
   knowing the drift isn't limited to just this one column.

**No table/column/enum was added, removed, or renamed on the actual
database** — every change here only teaches the local Prisma Client about
columns that already exist live. Worth reconciling upstream in EOS-backend
too (regenerate `schema.prisma` from the real database, or vice versa).

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
└── .transformers-cache/  cached SBERT ONNX weights (auto-downloaded, ~118MB — see Setup)
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

  **A free-tier Supabase project can also auto-pause after a period of no
  traffic**, and the next request or two can fail while it wakes back up —
  seen live as a ~1-minute burst of `P1001 Can't reach database server`
  errors that then resolved on their own with no code change. Nothing in
  this app's code can make Supabase wake up faster, but `errorHandler.middleware.ts`
  specifically detects this class of Prisma error (`P1001`/`P1002`/`P1008`/`P1017`
  — "can't reach the database at all", not a query that ran and hit a real
  problem) and returns a clear `503 "Our systems are temporarily
  unavailable. Please try again in a moment."` instead of lumping it in
  with the generic `500 "Something went wrong"` a real bug would produce —
  same failure, but honest about which kind it is.
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
2. Embeds all 2,568 example utterances with SBERT into `src/embeddings/embeddings.json`.

**The SBERT ONNX model weights are auto-downloaded on first run, NOT
committed to the repo.** This changed when the classifier moved to the
multilingual model (`paraphrase-multilingual-MiniLM-L12-v2`, ~118MB
quantized) — the original English-only model (`all-MiniLM-L6-v2`, ~23MB)
was small enough to commit straight into `.transformers-cache/` for
air-gapped/offline-first setup, but the multilingual model's weights
exceed GitHub's 100MB per-file limit, so a plain `git push` would reject
them outright. Practical effect: **the very first `npm run train` needs
internet access** to pull the model from the Hugging Face hub; every run
after that is fully offline against the local cache, same as before. If
your network blocks the HF hub outright (the original reason the smaller
model was committed), either copy a pre-populated
`.transformers-cache/Xenova/paraphrase-multilingual-MiniLM-L12-v2/` folder
from another machine, or use Git LFS.

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

### Learning pipeline endpoints (all require `Authorization: Bearer`)

See [Learning pipeline](#learning-pipeline) for the full review/approve/merge
workflow these support.

- **`POST /learning/feedback`** — `{ queryId, rating: 1-5, notes? }` ->
  `{ success: true, message }`. Records self-reported feedback on a past
  query (`query_logs.user_feedback_rating`/`is_correct`). Since this is
  entirely self-reported with no verification, see the review-gate note in
  [Learning pipeline](#learning-pipeline) for why it does NOT directly
  produce approved training data.
- **`GET /learning/stats?days=7`** -> query volume/accuracy/confidence
  stats over the window (`src/services/learning/query-logger.service.ts`
  `getQueryStats`).
- **`GET /learning/performance-history?limit=10`** -> recent
  `model_performance` snapshots (one per weekly analysis run).
- **`POST /learning/analyze`** — **admin only** (403 otherwise). Body:
  `{ days?: 7 }`. Manually triggers the same analysis the Sunday 2 AM cron
  runs, instead of waiting for it — useful right after a burst of real
  usage you want candidate examples from sooner. Returns the same shape as
  the scheduled run logs.

## Intent coverage

The classifier is trained on **95 intents / 2,568 examples** as of the
latest dataset pass (`scripts/rebuild-dataset-v4.ts`) — held-out accuracy on
a freshly-composed 1,000-question benchmark is **86.1% (878/1,020)**, up
from a 70.8% baseline; see `chatbot-1000-question-test-report.pdf` for the
current per-intent breakdown, and regenerate anytime after a dataset change
with `npx tsx scripts/generate-1000-questions.ts`.

History below is kept for context on how the dataset got here — the
original 80-intent dataset plus a second pass (`scripts/augment-dataset-2.ts`)
that merged in a user-supplied generic pattern sheet: phrasings that
duplicated existing intents were added as more training examples, and four
genuinely new intents (`password_reset`, `general_facilities`,
`admissions_info`, `library_hours`) were appended under their own "General"
section. `scripts/augment-dataset.ts` similarly added ID/roll-number-centric
admin-lookup phrasing ("marks of 23IT001") after live testing found that
gap. `scripts/augment-dataset-5.ts` and `-6.ts` fixed two more classifier
collisions found by the full end-to-end sweep (`scripts/e2e-role-rbac-test.ts`):
"timetable for/of &lt;ID&gt;" — a completely natural admin/parent/hod
phrasing — was losing to `get_exam_schedule`'s own example "23IT001 exam
timetable"; and heavy typo-compounding ("shw me marsk of vignesh" — typo'd
verb + typo'd keyword + a bare name) scored just under the confidence
threshold on its own. All augmentation scripts back up the original
`.docx` to `.docx.bak` before writing (once — later scripts share the same
backup, taken from the pristine pre-augmentation original).
Real backend integration is wired up for a curated set covering every role
and several ERP modules (see `src/intent/intent.registry.ts`):

- **Student self-service** — also admin/coe (register-number lookup) and
  parent (their own linked child, via `parent_student_mapping`):
  `get_profile`, `get_attendance`, `get_timetable`, `get_marks`, `get_fees`,
  `get_exam_schedule`, `get_announcements`, `get_my_subjects`, `get_mentor`,
  `get_holidays`
- **Universal**: `library_hours`
- **Faculty** (also hod, who has their own linked faculty record like any
  other teaching staff): `faculty_my_classes`, `faculty_class_attendance`,
  `section_students`
- **Admin** (also hod, forced to their own department — see
  `admin-directory.service.ts`): `admin_list_students`, `admin_list_faculty`
- **Utility / safety** (no DB access, every role incl. parent/hod/coe —
  see below): `greeting`, `help`, `thanks`, `goodbye`, `bot_identity`,
  `wrong_answer`, `human_handoff`, `feedback_positive`, `abuse`,
  `injection_attempt`, `emergency_or_distress`
- **Out of scope**: `out_of_scope` + all `oos_*` intents (CGPA, mess menu,
  WiFi, syllabus, faculty contact, payment actions)
- **Real need, no backing data — honest redirect**: `password_reset`,
  `general_facilities`, `admissions_info` (distinct from `admin_admission_status`,
  which checks an *existing* application's status for admin)

### RBAC beyond student/faculty/admin

The live database has **27 distinct roles** (`hod`, `coe`, `parent`,
`librarian`, `warden`, `management`, `principal`, ...) — the original
dataset only ever defined student/faculty/admin, so every other role got a
safe but nearly useless "no permission" wall for almost everything. Extended
RBAC (`scripts/augment-dataset-3.ts` rewrites each affected intent's
`roles:` line in the `.docx`, then the code below honours it) to the three
roles with real backing data and real populations in the live DB:

- **`parent`** (7,201 real accounts) — full self-service-equivalent access
  to their own linked child/children's attendance, marks (published only,
  same as the child would see), fees, timetable, exam schedule (published
  only), subjects, mentor, and announcements (scoped to the child's class).
  A parent with more than one child gets asked which one by name if the
  message doesn't say; naming a real student who ISN'T their child is
  forbidden outright, exactly like the student-role backstop (see
  `student-lookup.util.ts`'s `resolveParentChild`).
- **`hod`** (15 accounts, each with their own linked `faculty` row) —
  treated like faculty for anything tied to their own teaching (today's
  timetable, `faculty_my_classes`), but with authority scoped to their
  **entire department** (not just classes they personally teach/mentor) for
  `faculty_class_attendance`, `section_students`, `admin_list_students`,
  `admin_list_faculty`, and announcement visibility — mirroring
  EOS-backend's own HOD visibility rule for announcements exactly.
- **`coe`** (1 account, no linked faculty row — a pure exam-authority role)
  — granted the same admin-style any-student lookup as admin, but only for
  `get_exam_schedule`, matching their real backend authority (the
  exam-timetable module is `@Roles(COE)`-only there too) rather than
  granting blanket admin-equivalent access to everything.

Every other role (librarian, warden, management, principal, ...) still
gets a safe, honest "no permission" response for these intents — extending
to them would mean new intents tied to their own domains (library
management, hostel management, ...), not just an RBAC list change, and is
future work, not something this pass claims to have covered.

**Follow-up fix (`scripts/augment-dataset-5.ts`), found by a full
role×intent end-to-end sweep (`scripts/e2e-role-rbac-test.ts`):** the pass
above only ever touched data-bearing intents. `parent`, `hod`, and `coe`
were still completely missing from every safety-critical and universal
utility intent (`greeting`, `thanks`, `help`, `emergency_or_distress`,
`abuse`, `injection_attempt`, ...) and every generic out-of-scope/redirect
intent (`oos_*`, `password_reset`, `library_hours`, ...) — none of which
touch any role-scoped data. In practice a parent saying "hi", or genuinely
expressing distress, got a flat "Sorry, you don't have permission" instead
of a real reply. Fixed by adding those three roles to all 22 affected
intents; verified live for all six roles.

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

## LLM-assisted reranking and paraphrasing

Two narrow, additive uses of a local instruction-tuned model
([Ollama](https://ollama.com), `llama3.2:3b` by default) — both fail safe
to the existing deterministic/SBERT behavior on any timeout, unreachable
daemon, or unexpected output. Neither is ever allowed to introduce a new
fact.

1. **Intent reranking** (`src/intent/llm-reranker.ts`) — after SBERT picks
   a winner, hands its top `INTENT_LLM_RERANK_TOP_K` candidates (real
   descriptions + example phrasings, not just scores) to Ollama to confirm
   or override. Only runs when SBERT's own confidence is below
   `INTENT_LLM_RERANK_CEILING` (default 0.72) — reranking every
   classification unconditionally was measured to reduce accuracy (778→722
   correct on the 1,000-question set), because reconsidering an
   already-correct high-confidence pick has only downside risk. Gated,
   it's a net improvement (778→795, 76.3%→77.9%).
2. **Reply paraphrasing** (`src/reply/paraphraser.ts`) — rewords an
   already-correct, data-driven reply for more natural phrasing. Never
   queries the database itself — only rewords a sentence a handler already
   built from real data. Every rewrite must preserve every numeric token,
   every N-of-M ratio (checked as an ordered pair), and every proper noun
   from the original exactly, plus clear a semantic-similarity floor
   (cosine ≥ 0.8) — any failure falls back to the untouched original.

Setup: `ollama pull llama3.2:3b`. Both features are optional
(`INTENT_LLM_RERANK_ENABLED` / `REPLY_PARAPHRASE_ENABLED`, both default
`true`) — the chatbot works correctly without Ollama running at all, just
with slightly more template-y replies and no rerank safety net.

## Learning pipeline

Three chatbot-owned tables (`query_logs`, `training_examples`,
`model_performance` — plain `CREATE TABLE`, no migration framework, no
relation to any existing EOS/ERP table) back a lightweight
self-improvement loop:

- Every chat turn is logged (`src/services/learning/query-logger.service.ts`,
  fire-and-forget, never blocks the reply).
- A weekly cron job (`node-cron`, Sunday 2 AM,
  `src/scripts/scheduled-analyzer.ts`) analyzes the last 7 days and
  auto-INSERTS candidate new training examples from incorrect/low-confidence
  queries — but they land **pending** (`approved_at IS NULL`), never
  auto-approved. A candidate becomes eligible for real use only after an
  explicit human review step:
  1. `npx tsx scripts/review-training-candidates.ts` — lists everything
     pending, grouped by intent.
  2. `npx tsx scripts/approve-training-candidates.ts <id> [id ...]` —
     explicitly approves specific ids after a human has actually judged
     them (no "approve everything" shortcut, on purpose).
  3. `npx tsx scripts/merge-approved-training-examples.ts` — pulls every
     approved candidate into `intents.json`/the `.docx` (same
     dedupe-and-round-trip-verify discipline as every `rebuild-dataset-vN.ts`).
  4. `npm run train:embed` + restart the server — still manual, on purpose;
     nothing re-embeds or restarts automatically.

  This used to auto-approve on insert (self-reported "that was correct"
  feedback became training data instantly, with zero review) — a real
  data-poisoning path, since anyone hitting `/chat` + `/learning/feedback`
  could shape future training just by asserting labels. Fixed; the pending
  state is now the only path in.
- `GET /learning/stats` and `POST /learning/feedback` expose this data to
  a caller; see `src/routes/learning.routes.ts`.

## Testing without a live database

```bash
npx tsx scripts/smoke-test-intents.ts
```

Exercises the SBERT classifier against known phrasings, typo variants, and
paraphrases across student/utility/out-of-scope categories — no database
required, since intent detection never touches Prisma.

To test the full pipeline (auth → RBAC → DB-backed reply) end to end, point
`DATABASE_URL` at a real (or local copy of the) EOS database, seed at least
one `active` user per role via EOS-backend's own `prisma/seed.ts`, then
either a single manual call:

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<seeded-student-email>","password":"<password>"}'

curl -X POST http://localhost:4000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"message":"Show my attendance"}'
```

or the full regression suite, against a **running** server (`npm run dev`
in another terminal):

```bash
npx tsx scripts/e2e-role-rbac-test.ts
```

Logs in as all 6 roles (needs a real seed-password account per role — see
`scripts/find-faculty-login.ts` / `scripts/discover-test-fixtures.ts` for
how to find or derive them) and exercises, over real HTTP: the entire RBAC
matrix (every trained intent × every role), fuzzy/typo/out-of-order admin
lookup phrasing, multi-turn session state (last-student carryover and the
pendingIntent clarification follow-up), RBAC security backstops (a
self-service role naming someone else's real ID, unlinked accounts, cross-
user session isolation), and real-data correctness on every wired handler.
This is what found the parent/hod/coe utility-intent gap and the two
classifier collisions described above and below.

With no database reachable, every non-DB path (health check, JWT
verification, RBAC denial, low-confidence fallback, all utility intents)
still works correctly and the server never crashes — DB-backed handlers
fail with a normal `500 INTERNAL_ERROR` instead, logged with the real
Prisma error. This was verified during development; see git history / PR
description for the exact request/response pairs exercised.

**Rate limiting note:** `e2e-role-rbac-test.ts` fires many rapid requests
per role, both per-IP (all simulated roles hit the same localhost IP) and
per-user (many messages to the same logged-in account in a row) — see
[Setup](#setup) for `RATE_LIMIT_PER_IP_PER_MINUTE` /
`RATE_LIMIT_PER_USER_PER_MINUTE`. If a real test run starts seeing 429s
that look like RBAC failures, bump those env vars for the duration of the
run rather than treating it as a regression.

## Removing the temporary login

See [`src/auth/README.md`](src/auth/README.md) — it's a self-contained
module by design. Delete `src/auth/` and
`src/middleware/verifyJwt.middleware.ts`, plug in the real ERP session
verification with the same `{ sub, name, role, roleId, email }` shape, done.
