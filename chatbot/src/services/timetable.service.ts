import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveOwnFaculty } from './faculty-lookup.util';
import { resolveTargetStudent, notFoundReply } from './student-lookup.util';
import { dayOfWeekName, formatHHMM, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

const TODAY = () => new Date().getDay(); // 0=Sunday..6=Saturday — matches timetable_slots.day_of_week (1=Mon..6=Sat)

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
  if (user.role === ROLES.STUDENT) {
    const student = await prisma.students.findUnique({ where: { user_id: user.sub }, select: { class_id: true } });
    if (!student?.class_id) {
      return { reply: "You haven't been assigned to a class yet, so I can't show a timetable.", intent: 'get_timetable', confidence: 1 };
    }
    return classTimetableToday(student.class_id, 'Today\'s classes are');
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
    return classTimetableToday(result.student.class_id, `${result.student.name}'s classes today are`);
  }

  if (user.role === ROLES.FACULTY || user.role === ROLES.HOD) {
    return facultyTimetableToday(user.sub);
  }

  return {
    reply: 'Which class would you like the timetable for? Please include the class name in your question.',
    intent: 'get_timetable',
    confidence: 1,
  };
}

async function classTimetableToday(classId: number, heading: string): Promise<ChatReply> {
  const day = TODAY();
  const slots = await prisma.timetable_slots.findMany({
    where: { class_id: classId, day_of_week: day },
    orderBy: { period_number: 'asc' },
    select: { start_time: true, subjects: { select: { name: true } } },
  });

  return formatDaySchedule(day, heading, slots.map((s) => ({ subject: s.subjects.name, start_time: s.start_time })));
}

async function facultyTimetableToday(userId: number): Promise<ChatReply> {
  const faculty = await resolveOwnFaculty(userId);
  if (!faculty) {
    return { reply: "I couldn't find a faculty profile linked to your account.", intent: 'get_timetable', confidence: 1 };
  }

  const day = TODAY();
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
    "Today's classes are",
    slots.map((s) => ({ subject: `${s.subjects.name} (${s.classes.section})`, start_time: s.start_time })),
  );
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
