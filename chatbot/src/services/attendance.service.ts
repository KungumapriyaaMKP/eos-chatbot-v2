import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive, subjectPronoun, type ResolvedStudent } from './student-lookup.util';
import { matchSubjectInMessage } from './subject-match.util';
import { round2, toDateOnly, endSentence, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import { computeAttendanceStats } from './attendance-stats.util';
import { matchDateInMessage } from './date-match.util';
import type { HandlerContext } from '../intent/intent.types';

/**
 * The 75% figure below is the standard AICTE/most-Indian-university
 * attendance requirement, NOT a value stored anywhere in this schema or
 * EOS-backend — there is no attendance_policy table or configured
 * threshold of any kind here. Every reply that uses it says so explicitly
 * rather than presenting it as this college's actual, confirmed policy.
 */
const ASSUMED_SHORTAGE_THRESHOLD = 75;
const SHORTAGE_PATTERN = /\b(shortage|which subjects?( am i| do i have)? (below|short)|below \d+\s*%|short of attendance)\b/i;

/**
 * get_attendance — student (own) / parent (own child) / admin (any
 * student, looked up by name, ID, roll, or register number, fuzzy-matched).
 * Same aggregation EOS-backend's MeAttendanceService does (present/absent
 * counts → percentage, overall and per-subject), read directly off
 * attendance_records since there's no admin-facing "attendance for student
 * X" REST endpoint yet.
 *
 * "which subjects am I short in" gets a per-subject breakdown table
 * instead of the usual single overall percentage — the #1 thing students
 * actually want from an attendance query per real usage, and answerable
 * from attendance_records grouped by subject_id.
 */
export async function getAttendance({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_attendance', confidence: 1 };
  }

  if (!target) {
    return { reply: notFoundReply(user, result, 'their attendance', 'get_attendance'), intent: 'get_attendance', confidence: 1 };
  }

  const subject = await matchSubjectInMessage(message, target.class_id);

  if (!subject && SHORTAGE_PATTERN.test(message)) {
    return getPerSubjectShortage(user, target);
  }

  // Real gap found live: "what was my attendance on 2026-08-13" returned
  // the all-time aggregate PERCENTAGE, completely ignoring the specific
  // date named — a single day's attendance is a STATUS (present/absent/
  // on_duty), not a percentage; averaging it into the whole history
  // answers a different question than the one actually asked.
  const targetDate = matchDateInMessage(message);
  if (targetDate) {
    return attendanceStatusForDate(user, target, subject, targetDate);
  }

  const records = await prisma.attendance_records.findMany({
    where: { student_id: target.id, ...(subject && { subject_id: subject.id }) },
    select: { status: true },
  });

  if (records.length === 0) {
    const scope = subject ? ` for ${subject.name}` : '';
    return {
      reply: endSentence(`I don't see any attendance records${scope} for ${target.name}`),
      intent: 'get_attendance',
      confidence: 1,
    };
  }

  const { present, total, percentage } = computeAttendanceStats(records);
  const who = possessive(user, target);
  const scope = subject ? ` in ${subject.name}` : ' overall';

  const reply =
    `${who} current attendance${scope} is ${percentage}%. ` +
    `${subjectPronoun(user)} have attended ${present} out of ${total} classes.`;

  return {
    reply,
    intent: 'get_attendance',
    confidence: 1,
    data: { student_id: target.id, subject: subject?.name ?? null, total, present, percentage },
  };
}

const STATUS_LABEL: Record<string, string> = { present: 'Present', absent: 'Absent', on_duty: 'On Duty' };

/** A single day's real attendance status(es) — see the date-gap comment in getAttendance above. */
async function attendanceStatusForDate(
  user: HandlerContext['user'],
  target: ResolvedStudent,
  subject: { id: number; name: string } | null,
  targetDate: Date,
): Promise<ChatReply> {
  const records = await prisma.attendance_records.findMany({
    where: { student_id: target.id, attendance_date: targetDate, ...(subject && { subject_id: subject.id }) },
    select: { status: true, subjects: { select: { name: true } } },
  });

  const who = possessive(user, target);
  const dateLabel = toDateOnly(targetDate);

  if (records.length === 0) {
    const scope = subject ? ` for ${subject.name}` : '';
    return {
      reply: `No attendance recorded${scope} for ${dateLabel} — that day may not have been marked, or there was no class scheduled.`,
      intent: 'get_attendance',
      confidence: 1,
      data: [],
    };
  }

  if (records.length === 1 && !records[0].subjects) {
    return {
      reply: `${who} attendance on ${dateLabel} was: ${STATUS_LABEL[records[0].status] ?? records[0].status}.`,
      intent: 'get_attendance',
      confidence: 1,
      data: records,
    };
  }

  const table = markdownTable(
    ['Subject', 'Status'],
    records.map((r) => [r.subjects?.name ?? 'Overall', STATUS_LABEL[r.status] ?? r.status]),
  );
  return { reply: `${who} attendance on ${dateLabel}:\n\n${table}`, intent: 'get_attendance', confidence: 1, data: records };
}

async function getPerSubjectShortage(user: HandlerContext['user'], target: ResolvedStudent): Promise<ChatReply> {
  const records = await prisma.attendance_records.findMany({
    where: { student_id: target.id, subject_id: { not: null } },
    select: { status: true, subject_id: true, subjects: { select: { name: true } } },
  });

  if (records.length === 0) {
    return {
      reply: endSentence(`I don't see any subject-wise attendance records for ${target.name}`),
      intent: 'get_attendance',
      confidence: 1,
    };
  }

  const bySubject = new Map<number, { name: string; total: number; present: number }>();
  for (const r of records) {
    if (r.subject_id === null || !r.subjects) continue;
    if (r.status !== 'present' && r.status !== 'absent') continue; // on_duty excluded, see attendance-stats.util.ts
    const entry = bySubject.get(r.subject_id) ?? { name: r.subjects.name, total: 0, present: 0 };
    entry.total += 1;
    if (r.status === 'present') entry.present += 1;
    bySubject.set(r.subject_id, entry);
  }

  const rows = [...bySubject.values()]
    .map((s) => ({ ...s, percentage: round2((s.present / s.total) * 100) }))
    .sort((a, b) => a.percentage - b.percentage);

  const short = rows.filter((r) => r.percentage < ASSUMED_SHORTAGE_THRESHOLD);
  const who = possessive(user, target);

  const table = markdownTable(
    ['Subject', 'Attendance', 'Status'],
    rows.map((r) => [r.name, `${r.percentage}% (${r.present}/${r.total})`, r.percentage < ASSUMED_SHORTAGE_THRESHOLD ? 'Short' : 'OK']),
  );

  const headline =
    short.length === 0
      ? `${who} attendance is at or above ${ASSUMED_SHORTAGE_THRESHOLD}% in every subject`
      : `${who} attendance is below ${ASSUMED_SHORTAGE_THRESHOLD}% in ${short.length} subject${short.length === 1 ? '' : 's'}`;

  return {
    reply:
      `${endSentence(headline)}\n\n${table}\n\n` +
      `(Using the standard ${ASSUMED_SHORTAGE_THRESHOLD}% attendance requirement — confirm your college's actual policy, since it isn't recorded in this system.)`,
    intent: 'get_attendance',
    confidence: 1,
    data: { student_id: target.id, rows, threshold: ASSUMED_SHORTAGE_THRESHOLD },
  };
}
