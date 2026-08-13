import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive, type ResolvedStudent } from './student-lookup.util';
import { matchSubjectInMessage } from './subject-match.util';
import { NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_mentor — student (own) / parent (own child) / admin (any student).
 * Reads class_mentors, the same table EOS-backend's own
 * announcements/faculty-classes scoping already relies on elsewhere — the
 * class mentor is just whichever faculty row is mapped to the student's
 * class for the most recent academic_year.
 *
 * Also answers the related-but-distinct "which faculty teaches me X" —
 * a student naming a specific subject wants the SUBJECT teacher, not the
 * class mentor (a class often has one mentor but several subject
 * teachers). Reuses faculty_subject_class_mapping, the same table
 * faculty_my_classes reads from the other direction.
 */
export async function getMentor({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_mentor', confidence: 1 };
  }

  if (!target) {
    return { reply: notFoundReply(user, result, 'their class mentor', 'get_mentor'), intent: 'get_mentor', confidence: 1 };
  }

  if (!target.class_id) {
    return {
      reply: `${target.name} hasn't been assigned to a class yet, so there's no mentor to show.`,
      intent: 'get_mentor',
      confidence: 1,
    };
  }

  const subject = await matchSubjectInMessage(message);
  if (subject) {
    return getSubjectFaculty(user, target, subject);
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

  const who = possessive(user, target);
  const f = mapping.faculty;

  const reply =
    `${who} class mentor is ${f.first_name} ${f.last_name}, ${f.designation} (${f.departments.name})` +
    (f.users?.email ? `. You can reach them at ${f.users.email}.` : '.');

  return { reply, intent: 'get_mentor', confidence: 1, data: mapping };
}

async function getSubjectFaculty(user: HandlerContext['user'], target: ResolvedStudent, subject: { id: number; name: string }): Promise<ChatReply> {
  const mapping = await prisma.faculty_subject_class_mapping.findFirst({
    where: { class_id: target.class_id!, subject_id: subject.id },
    orderBy: { academic_year: 'desc' },
    select: {
      faculty: {
        select: { first_name: true, last_name: true, designation: true, departments: { select: { name: true } }, users: { select: { email: true } } },
      },
    },
  });

  if (!mapping) {
    return {
      reply: `I couldn't find a faculty member assigned to teach ${target.name} ${subject.name}.`,
      intent: 'get_mentor',
      confidence: 1,
    };
  }

  const who = possessive(user, target);
  const f = mapping.faculty;
  const reply =
    `${subject.name} for ${who === 'Your' ? 'your' : who} class is taught by ${f.first_name} ${f.last_name}, ${f.designation} (${f.departments.name})` +
    (f.users?.email ? `. You can reach them at ${f.users.email}.` : '.');

  return { reply, intent: 'get_mentor', confidence: 1, data: mapping };
}
