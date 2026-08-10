import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getMyProjects({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_my_projects', confidence: 1 };
    }

    return {
      reply: `**Your Projects**\n\nView all projects you're part of, team members, and project status on the student portal.`,
      intent: 'get_my_projects',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch projects.', intent: 'get_my_projects', confidence: 1 };
  }
}

export async function getProjectJoinRequests({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'project_join_requests_status', confidence: 1 };
    }

    return {
      reply: `**Your Project Join Requests**\n\nTrack pending and approved project join requests on the project portal.`,
      intent: 'project_join_requests_status',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch join requests.', intent: 'project_join_requests_status', confidence: 1 };
  }
}
