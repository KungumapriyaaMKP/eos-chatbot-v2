import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveOwnFaculty, resolveFacultyByFreeText, type ResolvedFaculty } from './faculty-lookup.util';
import { resolveTargetClass } from './class-match.util';
import { joinNaturally, markdownTable, type ChatReply } from '../utils/response';
import { computeAttendanceStats } from './attendance-stats.util';
import type { HandlerContext } from '../intent/intent.types';

/**
 * faculty_my_classes — faculty/hod: their own classes (unchanged). admin/hod
 * can ALSO name a specific colleague ("classes handled by Bala Murugan") —
 * fuzzy name lookup via resolveFacultyByFreeText, the faculty-side
 * counterpart of the admin/coe student lookup in student-lookup.util.ts. An
 * hod's lookup is scoped to their own department (their real authority
 * boundary everywhere else in this codebase — see class-match.util.ts); if
 * naming someone doesn't match anything, hod falls back to "myself" (most
 * hod messages ARE about their own classes), admin gets asked to clarify
 * (admin has no "own classes" to fall back to).
 */
export async function getFacultyClasses({ user, message }: HandlerContext): Promise<ChatReply> {
  const own = user.role === ROLES.FACULTY || user.role === ROLES.HOD ? await resolveOwnFaculty(user.sub) : null;

  let faculty: ResolvedFaculty | null = null;
  if (user.role === ROLES.ADMIN) {
    faculty = await resolveFacultyByFreeText(message);
  } else if (user.role === ROLES.HOD) {
    faculty = (own && (await resolveFacultyByFreeText(message, own.department_id))) || own;
  } else {
    faculty = own;
  }

  if (!faculty) {
    return user.role === ROLES.ADMIN
      ? { reply: 'Which faculty member did you mean? Please include their name.', intent: 'faculty_my_classes', confidence: 1 }
      : { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_my_classes', confidence: 1 };
  }

  const isSelf = own !== null && faculty.id === own.id;

  const [teaching, mentoring] = await Promise.all([
    prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: faculty.id },
      select: {
        academic_year: true,
        subjects: { select: { name: true } },
        classes: { select: { section: true, departments: { select: { code: true } } } },
      },
    }),
    prisma.class_mentors.findMany({
      where: { faculty_id: faculty.id },
      select: { classes: { select: { section: true, departments: { select: { code: true } } } } },
    }),
  ]);

  if (teaching.length === 0 && mentoring.length === 0) {
    const reply = isSelf ? "You're not currently assigned to any classes." : `${faculty.name} isn't currently assigned to any classes.`;
    return { reply, intent: 'faculty_my_classes', confidence: 1 };
  }

  const table = markdownTable(
    ['Class', 'Role', 'Academic Year'],
    [
      ...teaching.map((t) => [`${t.classes.departments.code}-${t.classes.section}`, t.subjects.name, t.academic_year]),
      ...mentoring.map((m) => [`${m.classes.departments.code}-${m.classes.section}`, 'Class Mentor', '']),
    ],
  );

  const heading = isSelf ? 'Your classes' : `${faculty.name}'s classes`;
  return { reply: `${heading}:\n\n${table}`, intent: 'faculty_my_classes', confidence: 1, data: { teaching, mentoring } };
}

/** faculty_class_attendance — faculty/admin: attendance summary for a specific class. */
export async function getClassAttendance({ user, message }: HandlerContext): Promise<ChatReply> {
  const { match, candidates } = await resolveTargetClass(user, message);

  if (!match) {
    if (candidates.length === 0) {
      return { reply: "You're not assigned to any classes yet.", intent: 'faculty_class_attendance', confidence: 1 };
    }
    const options = joinNaturally(candidates.map((c) => c.label));
    return {
      reply: `Which class did you mean? You're linked to ${options}. Please include the class name in your question.`,
      intent: 'faculty_class_attendance',
      confidence: 1,
    };
  }

  const records = await prisma.attendance_records.findMany({
    where: { class_id: match.id },
    select: { status: true },
  });

  if (records.length === 0) {
    return { reply: `No attendance has been recorded yet for ${match.label}.`, intent: 'faculty_class_attendance', confidence: 1 };
  }

  const { present, total, percentage } = computeAttendanceStats(records);
  return {
    reply: `${match.label} attendance: ${percentage}% overall (${present} present out of ${total} records).`,
    intent: 'faculty_class_attendance',
    confidence: 1,
    data: { class: match.label, total, present, percentage },
  };
}

/** section_students — faculty/admin: roster of students in a class. */
export async function getSectionStudents({ user, message }: HandlerContext): Promise<ChatReply> {
  const { match, candidates } = await resolveTargetClass(user, message);

  if (!match) {
    if (candidates.length === 0) {
      return { reply: "You're not assigned to any classes yet.", intent: 'section_students', confidence: 1 };
    }
    const options = joinNaturally(candidates.map((c) => c.label));
    return {
      reply: `Which class did you mean? You're linked to ${options}. Please include the class name in your question.`,
      intent: 'section_students',
      confidence: 1,
    };
  }

  const students = await prisma.students.findMany({
    where: { class_id: match.id },
    select: { roll_no: true, student_id_no: true, soa_applications: { select: { first_name: true, last_name: true } } },
    orderBy: { roll_no: 'asc' },
  });

  if (students.length === 0) {
    return { reply: `No students found in ${match.label}.`, intent: 'section_students', confidence: 1 };
  }

  const table = markdownTable(
    ['Roll No', 'Name'],
    students.map((s) => [
      s.roll_no ?? s.student_id_no,
      [s.soa_applications?.first_name, s.soa_applications?.last_name].filter(Boolean).join(' ') || s.student_id_no,
    ]),
  );

  return {
    reply: `${match.label} has ${students.length} student(s):\n\n${table}`,
    intent: 'section_students',
    confidence: 1,
    data: students,
  };
}
