import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { toDateOnly, dayOfWeekName, markdownTable, type ChatReply } from '../utils/response';
import { matchDateInMessage } from './date-match.util';
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
 *
 * Real gap found live: "do i have class tomorrow" / "is tomorrow a
 * holiday" always got the SAME generic "next 8 upcoming holidays" table
 * regardless of what was asked — the caller had to scan the table
 * themselves to see if tomorrow's date happened to appear in it. When the
 * message names a specific day (today/tomorrow/a weekday/an explicit
 * date), this now answers that day directly instead.
 */
export async function getHolidays({ user, message }: HandlerContext): Promise<ChatReply> {
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

  const askedDate = matchDateInMessage(message, new Date());
  if (askedDate) {
    return specificDateReply(askedDate, today, academicCalendarIds);
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

  const table = markdownTable(['Holiday', 'Date'], unique.map((e) => [e.title, toDateOnly(e.event_date)]));

  return { reply: `Upcoming holidays:\n\n${table}`, intent: 'get_holidays', confidence: 1, data: unique };
}

/** Relative label for the asked-about date, only for "today"/"tomorrow" — anything further out just gets its date. */
function relativeDayLabel(askedDate: Date, today: Date): string {
  const diffDays = Math.round((askedDate.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return dayOfWeekName(askedDate.getUTCDay());
}

async function specificDateReply(askedDate: Date, today: Date, academicCalendarIds: number[] | undefined): Promise<ChatReply> {
  const event = await prisma.calendar_events.findFirst({
    where: {
      event_type: 'holiday',
      event_date: askedDate,
      ...(academicCalendarIds && { academic_calendar_id: { in: academicCalendarIds } }),
    },
    select: { title: true },
  });

  const label = relativeDayLabel(askedDate, today);
  const dateStr = toDateOnly(askedDate);
  const dow = askedDate.getUTCDay();
  const isWeekend = dow === 0 || dow === 6;

  if (event) {
    return {
      reply: `Yes — ${label} (${dateStr}) is a holiday: ${event.title}. No classes that day.`,
      intent: 'get_holidays',
      confidence: 1,
      data: event,
    };
  }

  if (isWeekend) {
    return {
      reply: `${label} (${dateStr}) is a ${dayOfWeekName(dow)} — no classes scheduled. It's not marked as a holiday on the academic calendar either way, since weekends usually aren't classes anyway.`,
      intent: 'get_holidays',
      confidence: 1,
    };
  }

  return {
    reply: `No — ${label} (${dateStr}) isn't marked as a holiday on the academic calendar, so regular classes are expected.`,
    intent: 'get_holidays',
    confidence: 1,
  };
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

/**
 * get_upcoming_events — student/parent/faculty/hod/admin. Real gap found
 * live: calendar_event_type_enum has TWO values, 'holiday' and 'event',
 * but nothing anywhere read the 'event' half at all -- "upcoming events" /
 * "events happening today" (a completely legitimate, real-data-backed
 * question -- seminars, fests, deadlines entered on the same academic
 * calendar as holidays) fell through to whatever unrelated intent
 * happened to share a word ("today") with it, in one live case landing on
 * faculty_class_attendance -- a student asking about campus events got an
 * RBAC denial. Mirrors get_holidays' structure exactly (same batch/
 * semester scoping, same date-aware direct-answer behavior), just
 * event_type='event' instead of 'holiday', and doesn't carry get_holidays'
 * "no classes that day" framing since an event doesn't cancel classes the
 * way a holiday does.
 */
export async function getUpcomingEvents({ user, message }: HandlerContext): Promise<ChatReply> {
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

  const askedDate = matchDateInMessage(message, new Date());
  if (askedDate) {
    return specificEventDateReply(askedDate, today, academicCalendarIds);
  }

  const events = await prisma.calendar_events.findMany({
    where: {
      event_type: 'event',
      event_date: { gte: today },
      ...(academicCalendarIds && { academic_calendar_id: { in: academicCalendarIds } }),
    },
    orderBy: { event_date: 'asc' },
    select: { event_date: true, title: true },
    take: RESULT_LIMIT * 3,
  });

  if (events.length === 0) {
    return { reply: 'No upcoming events found on the academic calendar.', intent: 'get_upcoming_events', confidence: 1 };
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

  const table = markdownTable(['Event', 'Date'], unique.map((e) => [e.title, toDateOnly(e.event_date)]));
  return { reply: `Upcoming events:\n\n${table}`, intent: 'get_upcoming_events', confidence: 1, data: unique };
}

async function specificEventDateReply(askedDate: Date, today: Date, academicCalendarIds: number[] | undefined): Promise<ChatReply> {
  const matches = await prisma.calendar_events.findMany({
    where: {
      event_type: 'event',
      event_date: askedDate,
      ...(academicCalendarIds && { academic_calendar_id: { in: academicCalendarIds } }),
    },
    select: { title: true },
  });

  const label = relativeDayLabel(askedDate, today);
  const dateStr = toDateOnly(askedDate);

  if (matches.length === 0) {
    return {
      reply: `No events are on record for ${label} (${dateStr}).`,
      intent: 'get_upcoming_events',
      confidence: 1,
    };
  }

  const titles = matches.map((m) => m.title).join(', ');
  return {
    reply: `${label} (${dateStr}): ${titles}.`,
    intent: 'get_upcoming_events',
    confidence: 1,
    data: matches,
  };
}
