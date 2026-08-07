import { prisma } from '../utils/prisma';
import { ROLES } from '../config/roles';
import { toDateOnly, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';
import type { Prisma } from '../generated/prisma/client';

const RESULT_LIMIT = 8;

/**
 * get_announcements — student/faculty/admin.
 *
 * Mirrors EOS-backend's AnnouncementsService.buildVisibilityQuery() exactly
 * (see EOS-backend/src/modules/announcements/announcements/announcements.service.ts)
 * for the student/faculty/admin branches — the only roles this intent is
 * scoped to per the training dataset. GET /announcements is already
 * correctly self-scoped server-side, so this handler exists only because
 * the chatbot reads Prisma directly rather than making an HTTP call — the
 * *rule* itself is reused, not reinvented.
 */
export async function getAnnouncements({ user }: HandlerContext): Promise<ChatReply> {
  const where = await buildVisibilityQuery(user.sub, user.role);

  const rows = await prisma.announcements.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: RESULT_LIMIT,
    select: { title: true, content: true, created_at: true },
  });

  if (rows.length === 0) {
    return { reply: 'No announcements for you right now.', intent: 'get_announcements', confidence: 1 };
  }

  const lines = rows.map((a) => `• ${a.title} (${toDateOnly(a.created_at)})`);
  const reply = `Latest announcements:\n\n${lines.join('\n')}`;

  return { reply, intent: 'get_announcements', confidence: 1, data: rows };
}

async function buildVisibilityQuery(
  userId: number,
  role: string,
): Promise<Prisma.announcementsWhereInput> {
  if (role === ROLES.ADMIN) {
    return {};
  }

  if (role === ROLES.FACULTY) {
    const faculty = await prisma.faculty.findUnique({ where: { user_id: userId }, select: { id: true } });
    const assignedClassIds = faculty ? await getAssignedClassIds(faculty.id) : [];

    return {
      OR: [
        { posted_by_user_id: userId },
        { users: { roles: { name: ROLES.ADMIN } } },
        {
          AND: [
            { users: { roles: { name: ROLES.HOD } } },
            { announcement_class_mapping: { some: { class_id: { in: assignedClassIds.length ? assignedClassIds : [-1] } } } },
          ],
        },
      ],
    };
  }

  if (role === ROLES.STUDENT) {
    const student = await prisma.students.findUnique({ where: { user_id: userId }, select: { class_id: true } });
    return { announcement_class_mapping: { some: { class_id: student?.class_id ?? -1 } } };
  }

  return { id: -1 }; // default-deny for any role outside the dataset's S/F/A scope
}

async function getAssignedClassIds(facultyId: number): Promise<number[]> {
  const [subjectMappings, mentorMappings] = await Promise.all([
    prisma.faculty_subject_class_mapping.findMany({ where: { faculty_id: facultyId }, select: { class_id: true } }),
    prisma.class_mentors.findMany({ where: { faculty_id: facultyId }, select: { class_id: true } }),
  ]);
  return [...new Set([...subjectMappings, ...mentorMappings].map((row) => row.class_id))];
}
