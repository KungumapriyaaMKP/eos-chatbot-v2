import { prisma } from '../utils/prisma';
import { resolveOwnFaculty } from './faculty-lookup.util';
import { resolveTargetClass } from './class-match.util';
import { round2, toDateOnly, monthName, markdownTable, joinNaturally, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

function formatMediaRequestStatus(status: string): string {
  switch (status) {
    case 'approved':
      return 'Approved';
    case 'fulfilled':
      return 'Fulfilled';
    case 'rejected':
      return 'Rejected';
    default:
      return 'Pending';
  }
}

/** faculty_media_request — faculty: own media_requests (equipment/AV booking requests to the media team). */
export async function getFacultyMediaRequest({ user }: HandlerContext): Promise<ChatReply> {
  const faculty = await resolveOwnFaculty(user.sub);
  if (!faculty) {
    return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_media_request', confidence: 1 };
  }

  const requests = await prisma.media_requests.findMany({
    where: { requested_by_faculty_id: faculty.id },
    orderBy: { created_at: 'desc' },
    take: 10,
    select: { description: true, status: true, created_at: true, media_file_url: true },
  });

  if (requests.length === 0) {
    return { reply: "You haven't submitted any media/equipment requests.", intent: 'faculty_media_request', confidence: 1 };
  }

  const table = markdownTable(
    ['Request', 'Submitted', 'Status'],
    requests.map((r) => [r.description, toDateOnly(r.created_at), formatMediaRequestStatus(r.status)]),
  );
  return { reply: `Your media/equipment requests:\n\n${table}`, intent: 'faculty_media_request', confidence: 1, data: requests };
}

/** faculty_mentees — faculty: students in every class this faculty mentors (class_mentors), not the classes they merely teach a subject in. */
export async function getFacultyMentees({ user }: HandlerContext): Promise<ChatReply> {
  const faculty = await resolveOwnFaculty(user.sub);
  if (!faculty) {
    return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_mentees', confidence: 1 };
  }

  const mentoredClasses = await prisma.class_mentors.findMany({ where: { faculty_id: faculty.id }, select: { class_id: true } });
  if (mentoredClasses.length === 0) {
    return { reply: "You're not the mentor for any class right now.", intent: 'faculty_mentees', confidence: 1 };
  }

  const students = await prisma.students.findMany({
    where: { class_id: { in: mentoredClasses.map((m) => m.class_id) } },
    select: { roll_no: true, student_id_no: true, soa_applications: { select: { first_name: true, last_name: true } } },
    orderBy: { roll_no: 'asc' },
  });

  if (students.length === 0) {
    return { reply: 'No students found in your mentee class(es).', intent: 'faculty_mentees', confidence: 1 };
  }

  const table = markdownTable(
    ['Roll No', 'Name'],
    students.map((s) => [s.roll_no ?? s.student_id_no, [s.soa_applications?.first_name, s.soa_applications?.last_name].filter(Boolean).join(' ') || s.student_id_no]),
  );
  return { reply: `Your mentee students (${students.length}):\n\n${table}`, intent: 'faculty_mentees', confidence: 1, data: students };
}

function formatPayslipStatus(status: string): string {
  return status === 'processed' ? 'Processed' : status === 'rejected' ? 'Rejected' : 'Pending';
}

/** faculty_payslip — faculty: own payslip_requests. */
export async function getFacultyPayslip({ user }: HandlerContext): Promise<ChatReply> {
  const faculty = await resolveOwnFaculty(user.sub);
  if (!faculty) {
    return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_payslip', confidence: 1 };
  }

  const payslips = await prisma.payslip_requests.findMany({
    where: { faculty_id: faculty.id },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: 6,
    select: { month: true, year: true, status: true },
  });

  if (payslips.length === 0) {
    return { reply: "You haven't requested any payslips yet.", intent: 'faculty_payslip', confidence: 1 };
  }

  const table = markdownTable(['Month', 'Year', 'Status'], payslips.map((p) => [monthName(p.month), p.year, formatPayslipStatus(p.status)]));
  return { reply: `Your payslip requests:\n\n${table}`, intent: 'faculty_payslip', confidence: 1, data: payslips };
}

/** faculty_invigilation — faculty: own invigilation_duties. */
export async function getFacultyInvigilation({ user }: HandlerContext): Promise<ChatReply> {
  const faculty = await resolveOwnFaculty(user.sub);
  if (!faculty) {
    return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_invigilation', confidence: 1 };
  }

  const duties = await prisma.invigilation_duties.findMany({
    where: { faculty_id: faculty.id },
    orderBy: { duty_date: 'asc' },
    select: { duty_date: true, shift: true, exams: { select: { exam_types: { select: { name: true } } } }, hall_plans: { select: { venues: { select: { name: true } } } } },
  });

  if (duties.length === 0) {
    return { reply: "You have no invigilation duties assigned right now.", intent: 'faculty_invigilation', confidence: 1 };
  }

  const table = markdownTable(
    ['Exam', 'Date', 'Venue', 'Shift'],
    duties.map((d) => [d.exams.exam_types.name, d.duty_date.toISOString().slice(0, 10), d.hall_plans.venues.name, d.shift ?? '—']),
  );
  return { reply: `Your invigilation duties:\n\n${table}`, intent: 'faculty_invigilation', confidence: 1, data: duties };
}

function formatAppraisalStatus(status: string): string {
  switch (status) {
    case 'hod_reviewed':
      return 'HOD reviewed';
    case 'hr_scored':
      return 'HR scored';
    case 'management_approved':
      return 'Management approved';
    case 'rejected':
      return 'Rejected';
    default:
      return 'Submitted';
  }
}

/** faculty_appraisal — faculty: own appraisal_requests. */
export async function getFacultyAppraisal({ user }: HandlerContext): Promise<ChatReply> {
  const faculty = await resolveOwnFaculty(user.sub);
  if (!faculty) {
    return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'faculty_appraisal', confidence: 1 };
  }

  const appraisals = await prisma.appraisal_requests.findMany({
    where: { faculty_id: faculty.id },
    orderBy: { academic_year: 'desc' },
    select: { academic_year: true, status: true },
  });

  if (appraisals.length === 0) {
    return { reply: "You have no appraisal submissions on record.", intent: 'faculty_appraisal', confidence: 1 };
  }

  const table = markdownTable(['Year', 'Status'], appraisals.map((a) => [a.academic_year, formatAppraisalStatus(a.status)]));
  return { reply: `Your appraisal history:\n\n${table}`, intent: 'faculty_appraisal', confidence: 1, data: appraisals };
}

/**
 * The 75% figure is the standard AICTE/most-Indian-university attendance
 * requirement, not a value stored anywhere in this schema — same caveat as
 * attendance.service.ts's per-subject shortage check and
 * exam-eligibility.service.ts (kept as a separate constant per-file
 * deliberately, in case a real policy source is ever added for just one).
 */
const ASSUMED_SHORTAGE_THRESHOLD = 75;

/** faculty_low_attendance — faculty: students below the shortage threshold across every class this faculty teaches/mentors. */
export async function getFacultyLowAttendance({ user, message }: HandlerContext): Promise<ChatReply> {
  const { match, candidates } = await resolveTargetClass(user, message);

  if (!match) {
    if (candidates.length === 0) {
      return { reply: "You're not assigned to any classes yet.", intent: 'faculty_low_attendance', confidence: 1 };
    }
    const options = joinNaturally(candidates.map((c) => c.label));
    return {
      reply: `Which class did you mean? You're linked to ${options}. Please include the class name in your question.`,
      intent: 'faculty_low_attendance',
      confidence: 1,
    };
  }

  const records = await prisma.attendance_records.findMany({
    where: { class_id: match.id },
    select: { status: true, student_id: true, students: { select: { roll_no: true, student_id_no: true, soa_applications: { select: { first_name: true, last_name: true } } } } },
  });

  if (records.length === 0) {
    return { reply: `No attendance has been recorded yet for ${match.label}.`, intent: 'faculty_low_attendance', confidence: 1 };
  }

  const byStudent = new Map<number, { total: number; present: number; label: string }>();
  for (const r of records) {
    if (r.status !== 'present' && r.status !== 'absent') continue; // on_duty excluded, see attendance-stats.util.ts
    const entry = byStudent.get(r.student_id) ?? {
      total: 0,
      present: 0,
      label: [r.students.soa_applications?.first_name, r.students.soa_applications?.last_name].filter(Boolean).join(' ') || r.students.roll_no || r.students.student_id_no,
    };
    entry.total += 1;
    if (r.status === 'present') entry.present += 1;
    byStudent.set(r.student_id, entry);
  }

  const short = [...byStudent.values()]
    .map((s) => ({ ...s, percentage: round2((s.present / s.total) * 100) }))
    .filter((s) => s.percentage < ASSUMED_SHORTAGE_THRESHOLD)
    .sort((a, b) => a.percentage - b.percentage);

  if (short.length === 0) {
    return {
      reply: `Every student in ${match.label} is at or above ${ASSUMED_SHORTAGE_THRESHOLD}% attendance (using the standard requirement — confirm your college's actual policy).`,
      intent: 'faculty_low_attendance',
      confidence: 1,
    };
  }

  const table = markdownTable(['Student', 'Attendance'], short.map((s) => [s.label, `${s.percentage}%`]));
  return {
    reply: `${short.length} student(s) in ${match.label} below ${ASSUMED_SHORTAGE_THRESHOLD}% attendance:\n\n${table}\n\n(Using the standard ${ASSUMED_SHORTAGE_THRESHOLD}% requirement — confirm your college's actual policy, since it isn't recorded in this system.)`,
    intent: 'faculty_low_attendance',
    confidence: 1,
    data: short,
  };
}
