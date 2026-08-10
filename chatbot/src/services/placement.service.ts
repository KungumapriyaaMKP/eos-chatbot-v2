import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getUpcomingDrives({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_upcoming_drives', confidence: 1 };
    }

    return {
      reply: `**Upcoming Placement Drives**\n\nPlease check the placement portal for current job openings and drive schedules.`,
      intent: 'get_upcoming_drives',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch placement drives.', intent: 'get_upcoming_drives', confidence: 1 };
  }
}

export async function getDriveApplications({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_drive_applications', confidence: 1 };
    }

    return {
      reply: `**Your Placement Drive Applications**\n\nYou can view and manage your drive applications on the placement portal.`,
      intent: 'get_drive_applications',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch drive applications.', intent: 'get_drive_applications', confidence: 1 };
  }
}
