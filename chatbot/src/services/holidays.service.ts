import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { toDateOnly, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

const RESULT_LIMIT = 8;

/**
 * get_holidays — student/parent/faculty/hod/admin. Reads calendar_events
 * (event_type='holiday') via academic_calendars. Students (and a parent, on
 * behalf of their child) are scoped to their own batch + current
 * semester's calendar (holidays can fall on different dates per batch,
 * since academic_calendars is keyed by batch+semester). A parent with more
 * than one child uses the first one — the calendars mostly overlap anyway,
 * this is just a best-effort refinement, not a security boundary the way
 * it is for the other parent-facing intents. Faculty/hod/admin have no
 * single batch to scope by, so they see the institution-wide upcoming list
 * instead, deduplicated by title+date since the same public holiday is
 * usually entered once per batch's calendar.
 */
export async function getHolidays({ user }: HandlerContext): Promise<ChatReply> {
  const today = new Date(new Date().toISOString().slice(0, 10));

  let academicCalendarIds: number[] | undefined;

  const batchAndSemester = await resolveBatchAndSemester(user);
  if (batchAndSemester) {
    const calendars = await prisma.academic_calendars.findMany({
      where: {
        batch_id: batchAndSemester.batch_id,
        ...(batchAndSemester.semester != null && { semester: batchAndSemester.semester }),
      },
      select: { id: true },
    });
    academicCalendarIds = calendars.map((c) => c.id);
  }

  const events = await prisma.calendar_events.findMany({
    where: {
      event_type: 'holiday',
      event_date: { gte: today },
      ...(academicCalendarIds && { academic_calendar_id: { in: academicCalendarIds } }),
    },
    orderBy: { event_date: 'asc' },
    select: { event_date: true, title: true },
    take: RESULT_LIMIT * 3, // over-fetch a bit since we may dedupe below
  });

  if (events.length === 0) {
    return { reply: 'No upcoming holidays found on the academic calendar.', intent: 'get_holidays', confidence: 1 };
  }

  const seen = new Set<string>();
  const unique: typeof events = [];
  for (const e of events) {
    const key = `${e.title}|${toDateOnly(e.event_date)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
    if (unique.length >= RESULT_LIMIT) break;
  }

  const lines = unique.map((e) => `• ${e.title} on ${toDateOnly(e.event_date)}`);

  return { reply: `Upcoming holidays:\n\n${lines.join('\n')}`, intent: 'get_holidays', confidence: 1, data: unique };
}

async function resolveBatchAndSemester(
  user: HandlerContext['user'],
): Promise<{ batch_id: number; semester: number | null } | null> {
  if (user.role === ROLES.STUDENT) {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
      select: { batch_id: true, classes: { select: { current_semester: true } } },
    });
    return student ? { batch_id: student.batch_id, semester: student.classes?.current_semester ?? null } : null;
  }

  if (user.role === ROLES.PARENT) {
    const mapping = await prisma.parent_student_mapping.findFirst({
      where: { parent_user_id: user.sub },
      select: { students: { select: { batch_id: true, classes: { select: { current_semester: true } } } } },
    });
    return mapping ? { batch_id: mapping.students.batch_id, semester: mapping.students.classes?.current_semester ?? null } : null;
  }

  return null;
}
