import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getStudentCertificates({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_student_certificates', confidence: 1 };
    }

    return {
      reply: `**Your Certificates**\n\nView and download all your academic and participation certificates on the student portal.`,
      intent: 'get_student_certificates',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch certificates.', intent: 'get_student_certificates', confidence: 1 };
  }
}
