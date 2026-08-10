import { prisma } from '../utils/prisma';
import { markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getODStatus({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_od_status', confidence: 1 };
    }

    return {
      reply: `**Your OD (On-Duty) Status**\n\nYou can view your OD applications and approval status on the student portal. Submit new OD requests through the portal.`,
      intent: 'get_od_status',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch OD status.', intent: 'get_od_status', confidence: 1 };
  }
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
    return { reply: 'Unable to fetch subject notes.', intent: 'get_subject_notes', confidence: 1 };
  }
}
