import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveOwnFaculty } from './faculty-lookup.util';
import { resolveTargetStudent, notFoundReply } from './student-lookup.util';
import { dayOfWeekName, formatHHMM, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

const TODAY = () => new Date().getDay(); // 0=Sunday..6=Saturday — matches timetable_slots.day_of_week (1=Mon..6=Sat)

/**
 * Check if user is asking for full week timetable
 */
function isAskingForFullWeek(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('list') ||
    lower.includes('all') ||
    lower.includes('week') ||
    lower.includes('full') ||
    lower.includes('entire') ||
    lower.includes('complete')
  );
}

/**
 * Parse message to extract day request (tomorrow, Monday, etc.)
 * Returns day number (0=Sunday, 1=Monday, etc.) or null if not found
 */
function parseDayFromMessage(message: string): number | null {
  const lower = message.toLowerCase();
  const today = TODAY();

  // Check for "tomorrow"
  if (lower.includes('tomorrow')) {
    return (today + 1) % 7;
  }

  // Check for day names
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < dayNames.length; i++) {
    if (lower.includes(dayNames[i])) {
      return i;
    }
  }

  return null;
}

/**
 * get_timetable — student (own class, today) / parent (own child's class,
 * today) / faculty & hod (own schedule, today — an hod has their own
 * linked faculty record just like any other teaching staff) / admin (asks
 * for a class, since "today's timetable" is ambiguous for a role with no
 * class of their own).
 *
 * Mirrors EOS-backend's GET /me/timetable and GET /me/classes/today
 * exactly, just scoped to "today" to match the conversational format the
 * brief asks for ("Today's classes are: • Data Structures – 9:00 AM ...").
 */
export async function getTimetable({ user, message }: HandlerContext): Promise<ChatReply> {
  // Check if user is asking for full week
  const wantFullWeek = isAskingForFullWeek(message);

  // Parse message for specific day request (tomorrow, Monday, etc.)
  const requestedDay = parseDayFromMessage(message);

  if (user.role === ROLES.STUDENT) {
    const student = await prisma.students.findUnique({ where: { user_id: user.sub }, select: { class_id: true } });
    if (!student?.class_id) {
      return { reply: "You haven't been assigned to a class yet, so I can't show a timetable.", intent: 'get_timetable', confidence: 1 };
    }
    return wantFullWeek
      ? classFullWeekTimetable(student.class_id)
      : classTimetable(student.class_id, requestedDay, 'classes are');
  }

  if (user.role === ROLES.PARENT) {
    const result = await resolveTargetStudent(user, message);
    if (result.forbidden) {
      return { reply: NO_PERMISSION_MESSAGE, intent: 'get_timetable', confidence: 1 };
    }
    if (!result.student) {
      return { reply: notFoundReply(user, result, "their timetable", "get_timetable"), intent: 'get_timetable', confidence: 1 };
    }
    if (!result.student.class_id) {
      return {
        reply: `${result.student.name} hasn't been assigned to a class yet, so there's no timetable to show.`,
        intent: 'get_timetable',
        confidence: 1,
      };
    }
    return wantFullWeek
      ? classFullWeekTimetable(result.student.class_id, `${result.student.name}'s`)
      : classTimetable(result.student.class_id, requestedDay, `${result.student.name}'s classes are`);
  }

  if (user.role === ROLES.FACULTY || user.role === ROLES.HOD) {
    return wantFullWeek
      ? facultyFullWeekTimetable(user.sub)
      : facultyTimetable(user.sub, requestedDay);
  }

  return {
    reply: 'Which class would you like the timetable for? Please include the class name in your question.',
    intent: 'get_timetable',
    confidence: 1,
  };
}

async function classTimetable(classId: number, requestedDay: number | null, heading: string): Promise<ChatReply> {
  const day = requestedDay ?? TODAY();
  const slots = await prisma.timetable_slots.findMany({
    where: { class_id: classId, day_of_week: day },
    orderBy: { period_number: 'asc' },
    select: { start_time: true, subjects: { select: { name: true } } },
  });

  return formatDaySchedule(day, heading, slots.map((s) => ({ subject: s.subjects.name, start_time: s.start_time })));
}

async function facultyTimetable(userId: number, requestedDay: number | null): Promise<ChatReply> {
  const faculty = await resolveOwnFaculty(userId);
  if (!faculty) {
    return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'get_timetable', confidence: 1 };
  }

  const day = requestedDay ?? TODAY();
  const slots = await prisma.timetable_slots.findMany({
    where: { faculty_id: faculty.id, day_of_week: day },
    orderBy: { period_number: 'asc' },
    select: {
      start_time: true,
      subjects: { select: { name: true } },
      classes: { select: { section: true } },
    },
  });

  return formatDaySchedule(
    day,
    "Classes are",
    slots.map((s) => ({ subject: `${s.subjects.name} (${s.classes.section})`, start_time: s.start_time })),
  );
}

async function classFullWeekTimetable(classId: number, prefix: string = ''): Promise<ChatReply> {
  const allSlots = await prisma.timetable_slots.findMany({
    where: { class_id: classId },
    orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
    select: { day_of_week: true, start_time: true, end_time: true, subjects: { select: { name: true } } },
  });

  if (allSlots.length === 0) {
    return { reply: 'No timetable entries found.', intent: 'get_timetable', confidence: 1 };
  }

  // Generate grid-style timetable
  const gridTable = generateGridTimetable(allSlots);
  const reply = `${prefix} Full Week Timetable\n\n${gridTable}`;

  return { reply, intent: 'get_timetable', confidence: 1, data: { allSlots } };
}

async function facultyFullWeekTimetable(userId: number): Promise<ChatReply> {
  const faculty = await resolveOwnFaculty(userId);
  if (!faculty) {
    return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'get_timetable', confidence: 1 };
  }

  const allSlots = await prisma.timetable_slots.findMany({
    where: { faculty_id: faculty.id },
    orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
    select: {
      day_of_week: true,
      start_time: true,
      end_time: true,
      subjects: { select: { name: true } },
      classes: { select: { section: true } },
    },
  });

  if (allSlots.length === 0) {
    return { reply: 'No timetable entries found.', intent: 'get_timetable', confidence: 1 };
  }

  // Generate grid-style timetable
  const gridTable = generateGridTimetable(allSlots);
  const reply = `Your Full Week Timetable\n\n${gridTable}`;

  return { reply, intent: 'get_timetable', confidence: 1, data: { allSlots } };
}

/**
 * Generate clean table-style timetable (DAY | CLASSES format)
 */
function generateGridTimetable(
  allSlots: Array<{
    day_of_week: number;
    start_time: Date;
    end_time?: Date | null;
    subjects: { name: string };
    classes?: { section: string } | null;
  }>,
): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const tableData: string[][] = [['DAY', 'CLASSES']];

  // Build a row for each day
  for (let day = 0; day < 7; day++) {
    const daySlots = allSlots.filter((s) => s.day_of_week === day).sort((a, b) => {
      const timeA = formatHHMM(a.start_time);
      const timeB = formatHHMM(b.start_time);
      return timeA.localeCompare(timeB);
    });

    const dayName = dayNames[day];
    let classesText: string;

    if (daySlots.length === 0) {
      classesText = 'No classes';
    } else {
      const classesList = daySlots.map((slot) => {
        const time = formatHHMM(slot.start_time);
        const subject = slot.subjects.name;
        return `${time} - ${subject}`;
      });
      classesText = classesList.join('\n');
    }

    tableData.push([dayName, classesText]);
  }

  return markdownTable(tableData[0], tableData.slice(1));
}

function formatDaySchedule(day: number, heading: string, slots: Array<{ subject: string; start_time: Date }>): ChatReply {
  if (slots.length === 0) {
    const reply =
      day === 0 || day === 6
        ? `No classes today (${dayOfWeekName(day)}).`
        : `No timetable entries found for today (${dayOfWeekName(day)}).`;
    return { reply, intent: 'get_timetable', confidence: 1, data: { day_of_week: day, slots: [] } };
  }

  const table = markdownTable(
    ['Time', 'Subject'],
    slots.map((s) => [formatHHMM(s.start_time), s.subject]),
  );
  const reply = `${heading}:\n\n${table}`;

  return { reply, intent: 'get_timetable', confidence: 1, data: { day_of_week: day, slots } };
}
