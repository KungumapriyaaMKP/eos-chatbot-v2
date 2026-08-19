import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive, subjectPronoun } from './student-lookup.util';
import { fuzzyFindBest } from '../utils/fuzzy';
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
    // subjectPronoun, not possessive -- same fix as leave-status.service.ts:
    // "hasn't" needs a subject pronoun ("You haven't applied"), not a
    // possessive adjective ("Your hasn't applied", the real live bug).
    return { reply: `${subjectPronoun(user)} haven't applied to any placement drives yet.`, intent: 'get_drive_applications', confidence: 1 };
  }

  const table = markdownTable(
    ['Company', 'Drive Date', 'Status'],
    applications.map((a) => [companyLabel(a.placement_drives), toDateOnly(a.placement_drives.scheduled_date), formatApplicationStatus(a.status)]),
  );

  return { reply: `${who} drive applications:\n\n${table}`, intent: 'get_drive_applications', confidence: 1, data: applications };
}

/**
 * get_company_info — student/faculty/admin: a company's profile_info,
 * matched by name in the message.
 *
 * Only companies with at least one REVEALED drive (see companyLabel above)
 * are discoverable here — otherwise this would be a side-channel around the
 * existing disclosure mechanism, letting someone confirm an undisclosed
 * recruiter's identity just by naming it directly instead of through
 * get_upcoming_drives' "Not yet disclosed" gate.
 */
export async function getCompanyInfo({ message }: HandlerContext): Promise<ChatReply> {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const companies = await prisma.companies.findMany({
    select: {
      id: true,
      name: true,
      profile_info: true,
      placement_drives: { select: { is_disclosed: true, disclosed_reveal_date: true } },
    },
  });

  const revealed = companies.filter((c) =>
    c.placement_drives.some(
      (d) => d.is_disclosed || (d.disclosed_reveal_date != null && new Date(d.disclosed_reveal_date.toISOString().slice(0, 10)) <= today),
    ),
  );

  const match = fuzzyFindBest(message, revealed, (c) => ({ name: c.name }));
  if (!match) {
    return { reply: 'Which company did you mean? Please include the company name.', intent: 'get_company_info', confidence: 1 };
  }

  return {
    reply: `${match.name}: ${match.profile_info ?? 'No additional profile information on record.'}`,
    intent: 'get_company_info',
    confidence: 1,
    data: match,
  };
}

/** get_profile_links — student (own) / admin (any student, looked up). Real student_profiles row (resume/LinkedIn/GitHub/coding profiles). */
export async function getProfileLinks({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  if (result.forbidden) {
    return { reply: NO_PERMISSION_MESSAGE, intent: 'get_profile_links', confidence: 1 };
  }
  if (!result.student) {
    return { reply: notFoundReply(user, result, 'their profile links', 'get_profile_links'), intent: 'get_profile_links', confidence: 1 };
  }

  const profile = await prisma.student_profiles.findUnique({
    where: { student_id: result.student.id },
    select: { resume_url: true, linkedin_url: true, github_url: true, leetcode_url: true, hackerrank_url: true, codeforces_url: true },
  });

  const who = possessive(user, result.student);
  if (!profile) {
    // subjectPronoun, not possessive -- same "Your hasn't ..." grammar bug fix as elsewhere.
    return { reply: `${subjectPronoun(user)} haven't added any placement profile links yet.`, intent: 'get_profile_links', confidence: 1 };
  }

  const rows: Array<[string, string]> = [
    ['Resume', profile.resume_url ?? 'Not added'],
    ['LinkedIn', profile.linkedin_url ?? 'Not added'],
    ['GitHub', profile.github_url ?? 'Not added'],
    ['LeetCode', profile.leetcode_url ?? 'Not added'],
    ['HackerRank', profile.hackerrank_url ?? 'Not added'],
    ['Codeforces', profile.codeforces_url ?? 'Not added'],
  ];
  const table = markdownTable(['Platform', 'Link'], rows);
  return { reply: `${who} placement profile links:\n\n${table}`, intent: 'get_profile_links', confidence: 1, data: profile };
}
