import { prisma } from '../utils/prisma';
import { markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';
import { logger } from '../utils/logger';

/**
 * Get faculty members who teach a specific subject
 */
export async function getFacultyBySubject({ user, message }: HandlerContext): Promise<ChatReply> {
  // Extract subject name from message
  const subjectName = extractSubjectName(message);

  if (!subjectName) {
    return {
      reply: 'Please specify which subject you want to know about. For example: "Who teaches Data Structures?"',
      intent: 'get_faculty_by_subject',
      confidence: 1,
    };
  }

  try {
    // Find subject by name (case-insensitive, partial match)
    const subject = await prisma.subjects.findFirst({
      where: {
        name: {
          contains: subjectName,
          mode: 'insensitive',
        },
      },
    });

    if (!subject) {
      return {
        reply: `I couldn't find a subject called "${subjectName}". Could you check the spelling or provide the full subject name?`,
        intent: 'get_faculty_by_subject',
        confidence: 1,
      };
    }

    // Get all faculty members teaching this subject
    const slots = await prisma.timetable_slots.findMany({
      where: {
        subject_id: subject.id,
      },
      select: {
        faculty_id: true,
        faculty: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            designation: true,
            users: {
              select: {
                email: true,
              },
            },
          },
        },
      },
      distinct: ['faculty_id'],
    });

    if (slots.length === 0) {
      return {
        reply: `No faculty members found teaching "${subject.name}" currently.`,
        intent: 'get_faculty_by_subject',
        confidence: 1,
      };
    }

    // Remove duplicates and format response
    const uniqueFaculty = Array.from(
      new Map(slots.map((s) => [s.faculty.id, s.faculty])).values(),
    );

    if (uniqueFaculty.length === 1) {
      const f = uniqueFaculty[0];
      const reply = `**${f.first_name} ${f.last_name}** teaches **${subject.name}**.
Designation: ${f.designation}
Email: ${f.users?.email || 'Not available'}`;
      return { reply, intent: 'get_faculty_by_subject', confidence: 1 };
    }

    // Multiple faculty - show as table
    const table = markdownTable(
      ['Faculty Name', 'Designation', 'Email'],
      uniqueFaculty.map((f) => [
        `${f.first_name} ${f.last_name}`,
        f.designation,
        f.users?.email || 'N/A',
      ]),
    );

    const reply = `**${uniqueFaculty.length} faculty members** teach **${subject.name}**:\n\n${table}`;
    return { reply, intent: 'get_faculty_by_subject', confidence: 1 };
  } catch (error) {
    logger.error('faculty-by-subject', `getFacultyBySubject failed for user ${user.sub}: ${error}`);
    return {
      reply: 'I encountered an error looking up the faculty. Please try again.',
      intent: 'get_faculty_by_subject',
      confidence: 1,
    };
  }
}

/**
 * Extract subject name from user message
 * Handles various phrasings like "who teaches X", "show me X faculty", etc.
 */
function extractSubjectName(message: string): string | null {
  const lower = message.toLowerCase();

  // Remove common question words/phrases
  let extracted = lower
    .replace(/^(who|what|which|show|tell|list|give|find|me|the|my|for|of|a|about)\s+/gi, '')
    .replace(/\s+(teaches|faculty|subject|name|professor|instructor)?$/gi, '')
    .trim();

  // Handle "X faculty name" → "X"
  extracted = extracted.replace(/\s+faculty\s+(name)?$/i, '').trim();

  // Handle "faculty (of|for) X" → "X"
  extracted = extracted.replace(/^faculty\s+(of|for)\s+/i, '').trim();

  if (!extracted || extracted.length < 2) {
    return null;
  }

  return extracted;
}
