import { prisma } from '../utils/prisma';
import { resolveOwnFaculty } from './faculty-lookup.util';
import { resolveTargetClass } from './class-match.util';
import { round2, joinNaturally, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/** faculty_my_classes — faculty only: every class/subject they're assigned to teach, plus any class they mentor. */
export async function getFacultyClasses({ user }: HandlerContext): Promise<ChatReply> {
  const faculty = await resolveOwnFaculty(user.sub);
  if (!faculty) {
    return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_my_classes', confidence: 1 };
  }

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
    return { reply: "You're not currently assigned to any classes.", intent: 'faculty_my_classes', confidence: 1 };
  }

  const lines = [
    ...teaching.map(
      (t) => `• ${t.classes.departments.code}-${t.classes.section}: ${t.subjects.name} (${t.academic_year})`,
    ),
    ...mentoring.map((m) => `• ${m.classes.departments.code}-${m.classes.section}: Class Mentor`),
  ];

  return { reply: `Your classes:\n\n${lines.join('\n')}`, intent: 'faculty_my_classes', confidence: 1, data: { teaching, mentoring } };
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

  const total = records.length;
  const present = records.filter((r) => r.status === 'present').length;

  if (total === 0) {
    return { reply: `No attendance has been recorded yet for ${match.label}.`, intent: 'faculty_class_attendance', confidence: 1 };
  }

  const percentage = round2((present / total) * 100);
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

  const lines = students.map((s) => {
    const name = [s.soa_applications?.first_name, s.soa_applications?.last_name].filter(Boolean).join(' ');
    return `• ${s.roll_no ?? s.student_id_no}: ${name || s.student_id_no}`;
  });

  return {
    reply: `${match.label} has ${students.length} student(s):\n\n${lines.join('\n')}`,
    intent: 'section_students',
    confidence: 1,
    data: students,
  };
}
