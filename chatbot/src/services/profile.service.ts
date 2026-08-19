import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { toDateOnly, markdownTable, type ChatReply } from '../utils/response';
import { getSessionContext } from '../intent/session-context';
import type { HandlerContext } from '../intent/intent.types';

/**
 * "am I the one being asked about, or is this a follow-up about the
 * student we were just discussing?" — real gap found live: faculty asked
 * "who was absent on 13 august" (got one real student back), then asked
 * bare "name", expecting THAT student's name — got the FACULTY's own
 * profile instead, since get_profile is unconditionally self-scoped.
 *
 * A first-person word ("my"/"i"/"me"/"myself") always means self,
 * unconditionally — this check only matters for the genuinely ambiguous
 * bare case ("name", "profile", "who is that", "details").
 */
const FIRST_PERSON_PATTERN = /\b(my|i|me|myself)\b/i;

/**
 * NOT the same thing as isLookupRole (student-lookup.util.ts) — that gates
 * ADMIN/COE looking up an ARBITRARY student by name/ID anywhere in the
 * institution, a real capability boundary. This is narrower: faculty/hod
 * already legitimately SAW this exact student's name moments ago, via
 * their own class's attendance roster (see faculty-classes.service.ts
 * classRosterForDate, the only place that sets lastStudentId for a
 * non-lookup role) — resolving "name" to that student isn't a new lookup
 * capability, it's just continuing an answer already authorized and
 * already given.
 */
const FOLLOWUP_ELIGIBLE_ROLES = new Set<string>([ROLES.FACULTY, ROLES.HOD, ROLES.ADMIN]);

/**
 * get_profile — student/faculty/admin, self-scoped by default (student_id /
 * faculty_id / user_id resolved from the JWT, exactly like EOS-backend's
 * own GET /me/profile and GET /auth/me) — EXCEPT a genuinely ambiguous
 * bare follow-up ("name", not "my profile") from a role that just saw a
 * specific student surfaced via their own class roster, which resolves to
 * that student instead. See FOLLOWUP_ELIGIBLE_ROLES above for why this
 * doesn't cross the real lookup-capability boundary.
 */
export async function getProfile({ user, message }: HandlerContext): Promise<ChatReply> {
  if (FOLLOWUP_ELIGIBLE_ROLES.has(user.role) && !FIRST_PERSON_PATTERN.test(message)) {
    const lastStudentId = getSessionContext(user.sub)?.lastStudentId;
    if (lastStudentId) {
      const reply = await studentBasicProfile(lastStudentId);
      if (reply) return reply;
    }
  }

  return selfProfile(user);
}

/** Basic (not full personal) profile for a student already legitimately surfaced to the caller — see FOLLOWUP_ELIGIBLE_ROLES above. */
async function studentBasicProfile(studentId: number): Promise<ChatReply | null> {
  const student = await prisma.students.findUnique({
    where: { id: studentId },
    select: {
      student_id_no: true,
      roll_no: true,
      classes: { select: { section: true, current_semester: true, departments: { select: { code: true } } } },
      soa_applications: { select: { first_name: true, last_name: true } },
    },
  });
  if (!student) return null;

  const name = [student.soa_applications?.first_name, student.soa_applications?.last_name].filter(Boolean).join(' ') || student.roll_no || student.student_id_no;

  const table = markdownTable(
    ['Field', 'Value'],
    [
      ['Name', name],
      ['Roll No', student.roll_no ?? 'N/A'],
      ['Student ID', student.student_id_no],
      ['Class', student.classes ? `${student.classes.departments.code}-${student.classes.section}` : 'N/A'],
      ['Semester', student.classes?.current_semester ?? 'N/A'],
    ],
  );

  return { reply: `Profile for the student just mentioned:\n\n${table}`, intent: 'get_profile', confidence: 1, data: student };
}

async function selfProfile(user: HandlerContext['user']): Promise<ChatReply> {
  // user.name already carries the same soa_applications-first, then
  // faculty-name, then email-local-part fallback that auth.service.ts
  // resolves once at login (resolveDisplayName) — reusing it here instead
  // of re-deriving from soa_applications alone avoids showing a blank
  // "N/A" for the (fairly common, in this seed data) case where a student
  // has no linked soa_applications row at all.
  if (user.role === ROLES.STUDENT) {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
      select: {
        student_id_no: true,
        roll_no: true,
        register_no: true,
        student_type: true,
        dayscholar_mode: true,
        date_of_birth: true,
        courses: { select: { name: true } },
        batches: { select: { name: true } },
        classes: { select: { section: true, current_semester: true } },
        soa_applications: { select: { first_name: true, last_name: true } },
      },
    });

    if (!student) {
      return { reply: "I couldn't find a student profile linked to your account.", intent: 'get_profile', confidence: 1 };
    }

    const name =
      [student.soa_applications?.first_name, student.soa_applications?.last_name].filter(Boolean).join(' ') || user.name;

    const table = markdownTable(
      ['Field', 'Value'],
      [
        ['Name', name],
        ['Course', student.courses.name],
        ['Batch', student.batches.name],
        ['Section', student.classes?.section ?? 'N/A'],
        ['Semester', student.classes?.current_semester ?? 'N/A'],
        ['Roll No', student.roll_no ?? 'N/A'],
        ['Student ID', student.student_id_no],
        ['Register No', student.register_no ?? 'N/A'],
        // Real gap found live: date_of_birth was fetched (select above)
        // but never shown here — a student specifically asking "what's my
        // dob" would get a correctly-classified reply with the one thing
        // they actually asked for silently missing.
        ['Date of Birth', student.date_of_birth ? toDateOnly(student.date_of_birth) : 'N/A'],
        // Same gap, found live a second time: "am I hosteller or
        // dayscholar" was a legitimate, correctly-classified question with
        // no matching row in this table at all -- student_type WAS
        // already being fetched (select above) but never displayed.
        // dayscholar_mode only applies to dayscholars (how they commute),
        // so it's shown only then rather than as a confusing "N/A" for
        // every hosteller.
        ['Student Type', student.student_type === 'hosteller' ? 'Hosteller' : 'Day Scholar'],
        ...(student.student_type === 'dayscholar' && student.dayscholar_mode
          ? ([['Commute Mode', student.dayscholar_mode === 'transport' ? 'College Transport' : 'Own Vehicle']] as [string, string][])
          : []),
      ],
    );

    return { reply: `Your profile:\n\n${table}`, intent: 'get_profile', confidence: 1, data: student };
  }

  if (user.role === ROLES.FACULTY) {
    const faculty = await prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: {
        first_name: true,
        last_name: true,
        designation: true,
        date_of_joining: true,
        departments: { select: { name: true, code: true } },
      },
    });

    if (!faculty) {
      return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'get_profile', confidence: 1 };
    }

    const table = markdownTable(
      ['Field', 'Value'],
      [
        ['Name', `${faculty.first_name} ${faculty.last_name}`],
        ['Designation', faculty.designation],
        ['Department', `${faculty.departments.name} (${faculty.departments.code})`],
        ['Joined On', faculty.date_of_joining ? toDateOnly(faculty.date_of_joining) : 'N/A'],
      ],
    );

    return { reply: `Your profile:\n\n${table}`, intent: 'get_profile', confidence: 1, data: faculty };
  }

  // Admin (and any other staff role that reaches here): no faculty/student
  // row to describe — just confirm identity from the users/roles tables.
  const account = await prisma.users.findUnique({
    where: { id: user.sub },
    select: { email: true, roles: { select: { name: true, description: true } } },
  });

  const table = markdownTable(
    ['Field', 'Value'],
    [
      ['Name', user.name],
      ['Role', account?.roles.name ?? user.role],
      ['Email', account?.email ?? user.email],
    ],
  );

  return {
    reply: `Your profile:\n\n${table}`,
    intent: 'get_profile',
    confidence: 1,
    data: account,
  };
}
