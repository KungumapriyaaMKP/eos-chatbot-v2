import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive, NO_LINKED_STUDENT_MESSAGE } from './student-lookup.util';
import { round2, toDateOnly, endSentence, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * The 75% figure is the standard AICTE/most-Indian-university attendance
 * requirement — NOT a value stored anywhere in this schema. Every reply
 * says so explicitly. Same convention as attendance.service.ts's shortage
 * check; kept as a separate constant here rather than importing that one,
 * since these two features are allowed to diverge if a real policy source
 * ever gets added for just one of them.
 */
const ASSUMED_ELIGIBILITY_THRESHOLD = 75;

/**
 * get_exam_eligibility — student (own) / admin (any student, looked up by
 * name/ID). Projects a best-case ("attend every remaining class") and
 * worst-case ("attend none more") final percentage using the student's
 * batch+semester academic_calendars.end_date as the projection horizon,
 * with known holidays (calendar_events) excluded from the remaining-day
 * count — the same data holidays.service.ts already reads. This is still
 * an ESTIMATE (weekday count standing in for actual scheduled periods,
 * since a precise count would require walking timetable_slots per day),
 * not an exact figure, and the reply says so.
 */
export async function getExamEligibility({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_exam_eligibility', confidence: 1 };
  }

  if (!target) {
    return { reply: notFoundReply(user, result, 'their exam eligibility', 'get_exam_eligibility'), intent: 'get_exam_eligibility', confidence: 1 };
  }

  const student = await prisma.students.findUnique({
    where: { id: target.id },
    select: { batch_id: true, classes: { select: { current_semester: true } } },
  });

  if (!student) {
    return { reply: NO_LINKED_STUDENT_MESSAGE, intent: 'get_exam_eligibility', confidence: 1 };
  }

  const records = await prisma.attendance_records.findMany({ where: { student_id: target.id }, select: { status: true } });
  const total = records.length;
  const present = records.filter((r) => r.status === 'present').length;
  const who = possessive(user, target);

  if (total === 0) {
    return {
      reply: endSentence(`I don't see any attendance records for ${target.name} yet, so I can't assess exam eligibility`),
      intent: 'get_exam_eligibility',
      confidence: 1,
    };
  }

  const currentPercentage = round2((present / total) * 100);
  const isEligibleNow = currentPercentage >= ASSUMED_ELIGIBILITY_THRESHOLD;

  const remaining = await estimateRemainingClassDays(student.batch_id, student.classes?.current_semester ?? null);

  const lines = [
    `${who} current attendance is ${currentPercentage}% (${present}/${total}).`,
    isEligibleNow
      ? `That's at or above the standard ${ASSUMED_ELIGIBILITY_THRESHOLD}% requirement — currently eligible.`
      : `That's below the standard ${ASSUMED_ELIGIBILITY_THRESHOLD}% requirement — not currently eligible.`,
  ];

  if (remaining !== null && remaining > 0) {
    const bestCase = round2(((present + remaining) / (total + remaining)) * 100);
    const worstCase = round2((present / (total + remaining)) * 100);

    lines.push(``, `Projected to the end of this semester (~${remaining} estimated class day(s) remaining):`);
    lines.push(`• If ${user.role === 'student' ? 'you attend' : 'they attend'} every remaining class: up to ${bestCase}%`);
    lines.push(`• If ${user.role === 'student' ? 'you attend' : 'they attend'} none of them: down to ${worstCase}%`);

    if (!isEligibleNow) {
      if (bestCase < ASSUMED_ELIGIBILITY_THRESHOLD) {
        lines.push(``, `Even attending every remaining class won't reach ${ASSUMED_ELIGIBILITY_THRESHOLD}% this semester based on this estimate.`);
      } else {
        const needed = Math.max(0, Math.ceil(ASSUMED_ELIGIBILITY_THRESHOLD * 0.01 * (total + remaining) - present));
        lines.push(``, `Attending at least ${needed} of the remaining ${remaining} estimated class day(s) would be enough to reach ${ASSUMED_ELIGIBILITY_THRESHOLD}%.`);
      }
    }
  }

  lines.push(
    ``,
    `(Using the standard ${ASSUMED_ELIGIBILITY_THRESHOLD}% attendance requirement and an estimated remaining-class-day count — confirm your college's actual eligibility policy and exact schedule, since neither is recorded in this system.)`,
  );

  return {
    reply: lines.join('\n'),
    intent: 'get_exam_eligibility',
    confidence: 1,
    data: { student_id: target.id, currentPercentage, isEligibleNow, remaining },
  };
}

/** Weekdays between today and the batch+semester's academic_calendars.end_date, minus known holidays in that window. Null if no calendar is on record. */
async function estimateRemainingClassDays(batchId: number, semester: number | null): Promise<number | null> {
  if (semester === null) return null;

  const calendar = await prisma.academic_calendars.findUnique({
    where: { batch_id_semester: { batch_id: batchId, semester } },
    select: { id: true, end_date: true },
  });
  if (!calendar) return null;

  const today = new Date(new Date().toISOString().slice(0, 10));
  const end = new Date(calendar.end_date.toISOString().slice(0, 10));
  if (end <= today) return 0;

  const holidayDates = await prisma.calendar_events.findMany({
    where: { academic_calendar_id: calendar.id, event_type: 'holiday', event_date: { gte: today, lte: end } },
    select: { event_date: true },
  });
  const holidaySet = new Set(holidayDates.map((h) => toDateOnly(h.event_date)));

  let weekdays = 0;
  for (let d = new Date(today); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day === 0 || day === 6) continue; // Sunday/Saturday
    if (holidaySet.has(toDateOnly(d))) continue;
    weekdays++;
  }
  return weekdays;
}
