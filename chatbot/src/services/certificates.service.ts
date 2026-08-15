import { prisma } from '../utils/prisma';
import { markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_student_certificates — student (own). Real student_certificates rows.
 *
 * Previously a stub — checked the student existed, then always replied
 * "view them on the portal" without ever querying student_certificates,
 * so it could never actually tell a student which certificates they have
 * or whether one is ready.
 */
export async function getStudentCertificates({ user }: HandlerContext): Promise<ChatReply> {
  const student = await prisma.students.findUnique({ where: { user_id: user.sub }, select: { id: true } });

  if (!student) {
    return { reply: "I couldn't find a student profile linked to your account.", intent: 'get_student_certificates', confidence: 1 };
  }

  const certificates = await prisma.student_certificates.findMany({
    where: { student_id: student.id },
    select: { is_available: true, verified_at: true, certificate_types: { select: { name: true } } },
  });

  if (certificates.length === 0) {
    return { reply: "You don't have any certificates on record yet.", intent: 'get_student_certificates', confidence: 1 };
  }

  const table = markdownTable(
    ['Certificate', 'Status'],
    certificates.map((c) => [c.certificate_types.name, c.is_available ? 'Available' : 'Not yet issued']),
  );

  return { reply: `Your certificates:\n\n${table}`, intent: 'get_student_certificates', confidence: 1, data: certificates };
}
