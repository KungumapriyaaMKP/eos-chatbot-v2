import { prisma } from '../utils/prisma';
import { toDateOnly, markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/**
 * get_borrowed_books — student (own). Real book_borrow_records rows not
 * yet returned.
 *
 * Previously a stub — checked the student existed, then always replied
 * "you can view this on the library portal" regardless of what's actually
 * on loan, never touching book_borrow_records at all (the exact table
 * admin-analytics.service.ts's getAdminOverdueBooks already reads for the
 * admin-facing equivalent). Real data now, same as every other handler.
 */
export async function getBorrowedBooks({ user }: HandlerContext): Promise<ChatReply> {
  const student = await prisma.students.findUnique({ where: { user_id: user.sub }, select: { id: true } });

  if (!student) {
    return { reply: "I couldn't find a student profile linked to your account.", intent: 'get_borrowed_books', confidence: 1 };
  }

  const records = await prisma.book_borrow_records.findMany({
    where: { student_id: student.id, returned_date: null },
    orderBy: { due_date: 'asc' },
    select: { due_date: true, books: { select: { title: true, author: true } } },
  });

  if (records.length === 0) {
    return { reply: "You don't have any books currently borrowed.", intent: 'get_borrowed_books', confidence: 1 };
  }

  const today = new Date(new Date().toISOString().slice(0, 10));
  const table = markdownTable(
    ['Title', 'Author', 'Due', 'Status'],
    records.map((r) => [
      r.books.title,
      r.books.author ?? '—',
      toDateOnly(r.due_date),
      r.due_date < today ? 'Overdue' : 'On loan',
    ]),
  );

  return { reply: `You have ${records.length} book(s) currently borrowed:\n\n${table}`, intent: 'get_borrowed_books', confidence: 1, data: records };
}

const STOP_WORDS = /\b(search|book|books|library|find|for|me|a|an|the|please|pls|show|is|there|available|do|does|you|have|any|catalog|catalogue)\b/gi;

/**
 * Only a LEADING "on"/"about"/"regarding" ("book **on** thermodynamics",
 * "notes **about** DBMS") -- deliberately not added to STOP_WORDS itself,
 * since those words can legitimately appear mid-title too ("A Treatise
 * **on** the Theory..."), and stripping every occurrence would risk
 * corrupting an exact-substring title match the same way "of"/"in" would.
 * A LEADING preposition introducing the real subject is unambiguous
 * either way, so trimming just that one occurrence is safe.
 */
const LEADING_PREPOSITION = /^(on|about|regarding)\s+/i;

function extractSearchTerm(message: string): string {
  const stripped = message.replace(STOP_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return stripped.replace(LEADING_PREPOSITION, '').trim();
}

/**
 * Real gap found live: "give me the list of books in the library" (a
 * generic "browse the catalogue" question, no specific title/author
 * named) left "give list of in" after extractSearchTerm's stopword
 * strip -- none of "give"/"list"/"of"/"in" are on STOP_WORDS -- and that
 * leftover was searched for literally, returning a confident-looking but
 * nonsensical "No books found matching 'give list of in'."
 *
 * Deliberately NOT fixed by adding "of"/"in" to STOP_WORDS -- both are
 * genuine substrings of real book titles ("Internet **of** Things",
 * "Theory **of** Computation"), so stripping them would break an actual
 * title search that happens to be built around a preposition. Instead,
 * this checks whether EVERY word left after extraction is a generic
 * connector word and nothing else -- a real title search always leaves
 * at least one substantial content word behind, so this only catches the
 * genuinely-empty "just filler words" case.
 */
const CONNECTOR_ONLY_WORDS = new Set(['give', 'list', 'of', 'in', 'all', 'what', 'tell', 'can', 'which', 'get', 'need', 'want', 'to', 'me']);
function isGenericBrowseResidual(term: string): boolean {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => CONNECTOR_ONLY_WORDS.has(w));
}

/**
 * search_books — any role: real books rows matching title/author/ISBN.
 *
 * Previously a stub — extracted a search term but never actually searched
 * anything, just told the user to go check the library portal themselves.
 */
export async function searchBooks({ message }: HandlerContext): Promise<ChatReply> {
  const searchTerm = extractSearchTerm(message);

  if (!searchTerm || searchTerm.length < 2 || isGenericBrowseResidual(searchTerm)) {
    return {
      reply: 'Please tell me what book you want to search for. Example: "Search for Data Structures"',
      intent: 'search_books',
      confidence: 1,
    };
  }

  const books = await prisma.books.findMany({
    where: {
      OR: [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { author: { contains: searchTerm, mode: 'insensitive' } },
        { isbn: { contains: searchTerm, mode: 'insensitive' } },
      ],
    },
    take: 10,
    select: { title: true, author: true, available_copies: true, total_copies: true },
  });

  if (books.length === 0) {
    return { reply: `No books found matching "${searchTerm}".`, intent: 'search_books', confidence: 1 };
  }

  const table = markdownTable(
    ['Title', 'Author', 'Available'],
    books.map((b) => [b.title, b.author ?? '—', `${b.available_copies}/${b.total_copies}`]),
  );

  return { reply: `${books.length} book(s) matching "${searchTerm}":\n\n${table}`, intent: 'search_books', confidence: 1, data: books };
}
