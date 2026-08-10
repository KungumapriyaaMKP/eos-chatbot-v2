import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function searchAlumniNetwork({ user, message }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'alumni_network_search', confidence: 1 };
    }

    const searchTerm = message.replace(/search|alumni|network|find|connect|batch|company/gi, '').trim();

    return {
      reply: `**Alumni Network**\n\nConnect with alumni by batch year or company. Search for career opportunities and networking on the alumni portal.`,
      intent: 'alumni_network_search',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to search alumni network.', intent: 'alumni_network_search', confidence: 1 };
  }
}

export async function getResultPublicationStatus({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_result_publication_status', confidence: 1 };
    }

    return {
      reply: `**Result Publication Status**\n\nCheck when exam results will be published. Notifications will be sent once results are declared.`,
      intent: 'get_result_publication_status',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch result publication status.', intent: 'get_result_publication_status', confidence: 1 };
  }
}

export async function viewDepartmentAchievements({ user }: HandlerContext): Promise<ChatReply> {
  try {
    return {
      reply: `**Department Achievements**\n\nView awards, recognitions, and accomplishments of your department on the college website.`,
      intent: 'view_department_achievements',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch achievements.', intent: 'view_department_achievements', confidence: 1 };
  }
}
