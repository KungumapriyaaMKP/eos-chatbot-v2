import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { resolveTargetStudent, adminLookupPrompt, NO_LINKED_STUDENT_MESSAGE } from './student-lookup.util';
import { NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_mentor — student (own) / admin (any student). Reads class_mentors,
 * the same table EOS-backend's own announcements/faculty-classes scoping
 * already relies on elsewhere — the class mentor is just whichever faculty
 * row is mapped to the student's class for the most recent academic_year.
 */
export async function getMentor({ user, message }: HandlerContext): Promise<ChatReply> {
  const { student: target, forbidden } = await resolveTargetStudent(user, message);

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_mentor', confidence: 1 };
  }

  if (!target) {
    const reply = user.role === ROLES.ADMIN ? adminLookupPrompt('their class mentor') : NO_LINKED_STUDENT_MESSAGE;
    return { reply, intent: 'get_mentor', confidence: 1 };
  }

  if (!target.class_id) {
    return {
      reply: `${target.name} hasn't been assigned to a class yet, so there's no mentor to show.`,
      intent: 'get_mentor',
      confidence: 1,
    };
  }

  const mapping = await prisma.class_mentors.findFirst({
    where: { class_id: target.class_id },
    orderBy: { academic_year: 'desc' },
    select: {
      faculty: {
        select: {
          first_name: true,
          last_name: true,
          designation: true,
          departments: { select: { name: true } },
          users: { select: { email: true } },
        },
      },
    },
  });

  if (!mapping) {
    return { reply: `No class mentor has been assigned for ${target.name}'s class yet.`, intent: 'get_mentor', confidence: 1 };
  }

  const who = user.role === ROLES.ADMIN ? `${target.name}'s` : 'Your';
  const f = mapping.faculty;

  const reply =
    `${who} class mentor is ${f.first_name} ${f.last_name}, ${f.designation} (${f.departments.name})` +
    (f.users?.email ? `. You can reach them at ${f.users.email}.` : '.');

  return { reply, intent: 'get_mentor', confidence: 1, data: mapping };
}
