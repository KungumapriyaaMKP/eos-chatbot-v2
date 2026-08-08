/**
 * Broad live spot-check across all 6 roles, run against a live server,
 * using freshly-discovered real fixtures (post-reseed). Not a full
 * regression suite (see e2e-role-rbac-test.ts for that, whose fixtures
 * still need a full refresh) — this is a fast, targeted pass over what
 * changed this session: transport, leave status, faculty-by-name lookup,
 * table formatting, and the core wired intents, per role.
 */
const BASE = 'http://localhost:4000';

const ACCOUNTS: Record<string, { email: string; password: string }> = {
  student: { email: 'arjun.k2022cse@sece.ac.in', password: 'EOS@test123' },
  parent: { email: 'parentof.22cs001@gmail.com', password: 'EOS@test123' },
  faculty: { email: 'arun.p@sece.ac.in', password: 'EOS@test123' },
  hod: { email: 'hod_cse@sece.ac.in', password: 'EOS@test123' },
  admin: { email: 'admin@eos.test', password: 'EOS@test123' },
  coe: { email: 'coe@eos.test', password: 'EOS@test123' },
};

async function login(email: string, password: string): Promise<string | null> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return body.accessToken ?? null;
}

async function chat(token: string, message: string): Promise<{ reply: string; intent: string | null }> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  return res.json();
}

const CHECKS: Record<string, string[]> = {
  student: [
    'my marks',
    'my attendance',
    "today's timetable",
    'my fees',
    'my subjects',
    'my mentor',
    'my bus route',
    'leave balance',
    'library hours',
    // Sibling-routing check (sibling-intents.ts): this phrasing classifies
    // to the faculty-only intent, but a student's own role should still
    // get their own real leave data via the sibling fallback, not a denial.
    'how many leaves have i taken this month',
  ],
  parent: ['my child marks', "my child's attendance"],
  faculty: [
    'my classes',
    'classes handled by Suresh Kumar',
    // Sibling-routing check, the reverse direction — student-phrased leave
    // wording should still resolve to the faculty's own leave data.
    'check my leave application',
  ],
  hod: ['classes in my department', 'faculty list'],
  admin: ['list students', 'list faculty', 'marks for 22CS001'],
  coe: ['exam schedule for 22CS001'],
};

async function main() {
  for (const [role, { email, password }] of Object.entries(ACCOUNTS)) {
    console.log(`\n=== ${role} (${email}) ===`);
    const token = await login(email, password);
    if (!token) {
      console.log('  LOGIN FAILED');
      continue;
    }
    for (const message of CHECKS[role] ?? []) {
      try {
        const { reply, intent } = await chat(token, message);
        const preview = reply.replace(/\n/g, ' ').slice(0, 90);
        const flag = /something went wrong|couldn't understand|don't have permission/i.test(reply) ? ' ⚠' : '';
        console.log(`  "${message}" [${intent}]${flag} -> ${preview}`);
      } catch (e) {
        console.log(`  "${message}" -> ERROR: ${(e as Error).message}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
