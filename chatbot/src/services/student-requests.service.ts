import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { toDateOnly, markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';
import { logger } from '../utils/logger';

function formatApprovalStatus(status: string): string {
  return status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending';
}

/**
 * get_od_status — student (own) / admin (any student, looked up). An OD
 * request applies to a whole project team (od_requests.team_id), with each
 * team member getting their own HOD approval row
 * (od_request_hod_approvals) — reads that per-student row, which also
 * carries the request's own from/to/reason via od_requests.
 */
export async function getODStatus({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_od_status', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their OD status', 'get_od_status'), intent: 'get_od_status', confidence: 1 };

  const approvals = await prisma.od_request_hod_approvals.findMany({
    where: { student_id: target.id },
    select: {
      status: true,
      reviewed_at: true,
      od_requests: { select: { from_date: true, to_date: true, reason: true, mentor_approval_status: true } },
    },
  });

  const who = possessive(user, target);
  if (approvals.length === 0) {
    return { reply: `${who} hasn't applied for On-Duty leave.`, intent: 'get_od_status', confidence: 1 };
  }

  const table = markdownTable(
    ['From', 'To', 'Mentor', 'HOD', 'Reason'],
    approvals.map((a) => [
      toDateOnly(a.od_requests.from_date),
      toDateOnly(a.od_requests.to_date),
      formatApprovalStatus(a.od_requests.mentor_approval_status),
      formatApprovalStatus(a.status),
      a.od_requests.reason ?? '—',
    ]),
  );
  return { reply: `${who} OD requests:\n\n${table}`, intent: 'get_od_status', confidence: 1, data: approvals };
}

export async function getNotifications({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const notifications = await prisma.notifications.findMany({
      where: { user_id: user.sub },
      select: {
        id: true,
        title: true,
        message: true,
        is_read: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    if (notifications.length === 0) {
      return { reply: 'You have no notifications.', intent: 'get_notifications', confidence: 1 };
    }

    const unread = notifications.filter((n) => !n.is_read).length;

    const table = markdownTable(
      ['Title', 'Read', 'Date'],
      notifications.map((n: any) => [
        n.title,
        n.is_read ? '✓' : '●',
        new Date(n.created_at).toLocaleDateString(),
      ]),
    );

    return {
      reply: `**Your Notifications** (${unread} unread)\n\n${table}`,
      intent: 'get_notifications',
      confidence: 1,
    };
  } catch (error) {
    // Previously swallowed silently — a real DB/schema failure here left
    // zero trace anywhere, indistinguishable in the logs from "no
    // notifications" or a normal request. Any handler that catches and
    // masks its own errors for a friendlier user-facing message must still
    // log the real one, or a production failure becomes undebuggable.
    logger.error('student-requests', `getNotifications failed for user ${user.sub}: ${error}`);
    return { reply: 'Unable to fetch notifications.', intent: 'get_notifications', confidence: 1 };
  }
}

export async function getSubjectNotes({ user, message }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
      select: { class_id: true },
    });

    if (!student || !student.class_id) {
      return { reply: "You don't have a student profile.", intent: 'get_subject_notes', confidence: 1 };
    }

    const notes = await prisma.lms_notes.findMany({
      where: { class_id: student.class_id },
      select: {
        id: true,
        title: true,
        uploaded_at: true,
        file_url: true,
        subject_id: true,
        faculty_id: true,
      },
      orderBy: { uploaded_at: 'desc' },
      take: 20,
    });

    if (notes.length === 0) {
      return { reply: 'No study notes available for your class yet.', intent: 'get_subject_notes', confidence: 1 };
    }

    const table = markdownTable(
      ['Note', 'Title', 'Date'],
      notes.map((n: any) => [
        `#${n.id}`,
        n.title,
        new Date(n.uploaded_at).toLocaleDateString(),
      ]),
    );

    return {
      reply: `**Study Notes Available** (${notes.length})\n\n${table}\n\nYou can download these notes from the LMS portal.`,
      intent: 'get_subject_notes',
      confidence: 1,
    };
  } catch (error) {
    logger.error('student-requests', `getSubjectNotes failed for user ${user.sub}: ${error}`);
    return { reply: 'Unable to fetch subject notes.', intent: 'get_subject_notes', confidence: 1 };
  }
}
