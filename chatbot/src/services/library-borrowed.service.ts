import { prisma } from '../utils/prisma';
import { type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

export async function getBorrowedBooks({ user }: HandlerContext): Promise<ChatReply> {
  try {
    const student = await prisma.students.findUnique({
      where: { user_id: user.sub },
    });

    if (!student) {
      return { reply: "You don't have a student profile.", intent: 'get_borrowed_books', confidence: 1 };
    }

    return {
      reply: `**Books You're Currently Borrowing**\n\nYou can view and manage your borrowed books on the library portal. Track due dates and renew books as needed.`,
      intent: 'get_borrowed_books',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to fetch borrowed books.', intent: 'get_borrowed_books', confidence: 1 };
  }
}

export async function searchBooks({ message }: HandlerContext): Promise<ChatReply> {
  try {
    const searchTerm = message.replace(/search|book|library|find/gi, '').trim();

    if (!searchTerm || searchTerm.length < 2) {
      return {
        reply: 'Please tell me what book you want to search for. Example: "Search for Data Structures"',
        intent: 'search_books',
        confidence: 1,
      };
    }

    return {
      reply: `**Book Search: "${searchTerm}"**\n\nYou can search for books in the library catalog on the library portal. Check availability and place holds for books.`,
      intent: 'search_books',
      confidence: 1,
    };
  } catch (error) {
    return { reply: 'Unable to search books.', intent: 'search_books', confidence: 1 };
  }
}
