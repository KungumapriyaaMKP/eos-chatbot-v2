import { prisma } from '../utils/prisma';
import { resolveTargetStudent, notFoundReply, possessive } from './student-lookup.util';
import { markdownTable, NO_PERMISSION_MESSAGE, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/** get_my_projects — student (own) / admin (any student, looked up). Real student_projects rows. */
export async function getMyProjects({ user, message }: HandlerContext): Promise<ChatReply> {
  const result = await resolveTargetStudent(user, message);
  const { student: target, forbidden } = result;
  if (forbidden) return { reply: NO_PERMISSION_MESSAGE, intent: 'get_my_projects', confidence: 1 };
  if (!target) return { reply: notFoundReply(user, result, 'their projects', 'get_my_projects'), intent: 'get_my_projects', confidence: 1 };

  const projects = await prisma.student_projects.findMany({
    where: { student_id: target.id },
    select: { title: true, description: true, faculty: { select: { first_name: true, last_name: true } } },
  });

  const who = possessive(user, target);
  if (projects.length === 0) {
    return { reply: `${who} isn't listed on any projects yet.`, intent: 'get_my_projects', confidence: 1 };
  }

  const table = markdownTable(
    ['Title', 'Mentor'],
    projects.map((p) => [p.title, p.faculty ? `${p.faculty.first_name} ${p.faculty.last_name}` : 'Unassigned']),
  );
  return { reply: `${who} projects:\n\n${table}`, intent: 'get_my_projects', confidence: 1, data: projects };
}

function formatJoinStatus(status: string | null): string {
  if (!status) return 'Pending';
  const upper = status.toUpperCase();
  return upper === 'APPROVED' ? 'Approved' : upper === 'REJECTED' ? 'Rejected' : 'Pending';
}

/** project_join_requests_status — student (own). Real project_join_requests rows. */
export async function getProjectJoinRequests({ user }: HandlerContext): Promise<ChatReply> {
  const student = await prisma.students.findUnique({ where: { user_id: user.sub }, select: { id: true } });
  if (!student) {
    return { reply: "I couldn't find a student profile linked to your account.", intent: 'project_join_requests_status', confidence: 1 };
  }

  const requests = await prisma.project_join_requests.findMany({
    where: { student_id: student.id },
    orderBy: { applied_at: 'desc' },
    select: { status: true, applied_at: true, project_teams: { select: { team_name: true } } },
  });

  if (requests.length === 0) {
    return { reply: "You haven't applied to join any project teams.", intent: 'project_join_requests_status', confidence: 1 };
  }

  const table = markdownTable(
    ['Team', 'Applied', 'Status'],
    requests.map((r) => [r.project_teams.team_name, r.applied_at ? r.applied_at.toISOString().slice(0, 10) : '—', formatJoinStatus(r.status)]),
  );
  return { reply: `Your project join requests:\n\n${table}`, intent: 'project_join_requests_status', confidence: 1, data: requests };
}
