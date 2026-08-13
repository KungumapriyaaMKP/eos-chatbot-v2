import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { toDateOnly, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

function companyLabel(drive: { is_disclosed: boolean; disclosed_reveal_date: Date | null; companies: { name: string } }): string {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const revealed = drive.is_disclosed || (drive.disclosed_reveal_date != null && new Date(drive.disclosed_reveal_date.toISOString().slice(0, 10)) <= today);
  return revealed ? drive.companies.name : 'Not yet disclosed';
}

function formatApplicationStatus(status: string): string {
  switch (status) {
    case 'r1_cleared':
      return 'Round 1 cleared';
    case 'r2_cleared':
      return 'Round 2 cleared';
    case 'r3_cleared':
      return 'Round 3 cleared';
    case 'placed':
      return 'Placed';
    case 'rejected':
      return 'Rejected';
    default:
      return 'Applied';
  }
}

/** get_upcoming_drives — student (own) / admin (any student, looked up). Real placement_drives rows, scheduled_date in the future. */
export async function getUpcomingDrives({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_upcoming_drives', confidence: 1 };
  }
  if (!target) {
    return { reply: notFoundReply(user, result, 'upcoming placement drives', 'get_upcoming_drives'), intent: 'get_upcoming_drives', confidence: 1 };
  }

  const today = new Date(new Date().toISOString().slice(0, 10));
  const drives = await prisma.placement_drives.findMany({
    where: { scheduled_date: { gte: today }, status: { not: 'cancelled' } },
    orderBy: { scheduled_date: 'asc' },
    select: { scheduled_date: true, status: true, is_disclosed: true, disclosed_reveal_date: true, companies: { select: { name: true } } },
  });

  if (drives.length === 0) {
    return { reply: 'No placement drives are currently scheduled.', intent: 'get_upcoming_drives', confidence: 1 };
  }

  const table = markdownTable(
    ['Company', 'Date', 'Status'],
    drives.map((d) => [companyLabel(d), toDateOnly(d.scheduled_date), d.status]),
  );

  return { reply: `Upcoming placement drives:\n\n${table}`, intent: 'get_upcoming_drives', confidence: 1, data: drives };
}

/** get_drive_applications — student (own) / admin (any student, looked up). Real student_drive_applications rows. */
export async function getDriveApplications({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;

  if (forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_drive_applications', confidence: 1 };
  }
  if (!target) {
    return { reply: notFoundReply(user, result, 'their drive applications', 'get_drive_applications'), intent: 'get_drive_applications', confidence: 1 };
  }

  const applications = await prisma.student_drive_applications.findMany({
    where: { student_id: target.id },
    orderBy: { updated_at: 'desc' },
    select: {
      status: true,
      updated_at: true,
      placement_drives: { select: { scheduled_date: true, is_disclosed: true, disclosed_reveal_date: true, companies: { select: { name: true } } } },
    },
  });

  const who = possessive(user, target);

  if (applications.length === 0) {
    return { reply: `${who} hasn't applied to any placement drives yet.`, intent: 'get_drive_applications', confidence: 1 };
  }

  const table = markdownTable(
    ['Company', 'Drive Date', 'Status'],
    applications.map((a) => [companyLabel(a.placement_drives), toDateOnly(a.placement_drives.scheduled_date), formatApplicationStatus(a.status)]),
  );

  return { reply: `${who} drive applications:\n\n${table}`, intent: 'get_drive_applications', confidence: 1, data: applications };
}
