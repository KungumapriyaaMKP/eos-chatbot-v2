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
 * "Theory **of** Computation", "Advances **in** Machine Learning"), so
 * stripping them unconditionally would break an actual title search built
 * around one of those words. Instead, this checks whether EVERY word left
 * after extraction is a generic connector word and nothing else -- a real
 * title search always leaves at least one substantial content word
 * behind, so this only catches the genuinely-empty "just filler words"
 * case, and is safe to keep growing without risking a real title match.
 *
 * "i", "full", and "in" were themselves a second, separate real bug on
 * top of the first fix: "I want the full list of books available in the
 * library" left "i want full list of in" behind -- "i" and "full" weren't
 * on this list at all, so the residual failed the "every word is a
 * connector" check and was searched for literally anyway. Found live via
 * the exact same failure mode the first fix was supposed to have already
 * closed -- a reminder that a subtractive word-list approach needs its
 * list kept honest, not just extended once and assumed complete.
 */
const CONNECTOR_ONLY_WORDS = new Set([
  'give', 'list', 'of', 'in', 'all', 'what', 'tell', 'can', 'which', 'get', 'need', 'want', 'to', 'me',
  'i', 'full', 'complete', 'entire', 'whole', 'every', 'lists',
]);
function isGenericBrowseResidual(term: string): boolean {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => CONNECTOR_ONLY_WORDS.has(w));
}

const BROWSE_LIMIT = 15;

/**
 * The actual "browse the catalogue" answer -- real gap found live: even
 * after correctly detecting "no real search term named" via
 * isGenericBrowseResidual, this used to respond with "please tell me what
 * book you want to search for" instead of just answering the question
 * that was actually asked ("give me the list of books", "what books do
 * you have") with the real, fetchable data. Asking the user to rephrase a
 * question that was already perfectly clear is worse than just answering
 * it -- there's no reason a generic browse should be treated as an error
 * case when the data to answer it directly is right there.
 */
async function browseAllBooks(): Promise<ChatReply> {
  const [total, books] = await Promise.all([
    prisma.books.count(),
    prisma.books.findMany({
      orderBy: { title: 'asc' },
      take: BROWSE_LIMIT,
      select: { title: true, author: true, available_copies: true, total_copies: true },
    }),
  ]);

  if (total === 0) {
    return { reply: 'The library catalogue is empty right now.', intent: 'search_books', confidence: 1 };
  }

  const table = markdownTable(
    ['Title', 'Author', 'Available'],
    books.map((b) => [b.title, b.author ?? '—', `${b.available_copies}/${b.total_copies}`]),
  );
  const more = total > books.length ? `\n\n...and ${total - books.length} more. Ask about a specific title, author, or subject to narrow this down.` : '';

  return {
    reply: `${total} book(s) in the library catalogue. Showing the first ${books.length}:\n\n${table}${more}`,
    intent: 'search_books',
    confidence: 1,
    data: { total, books },
  };
}

/**
 * search_books — any role: real books rows matching title/author/ISBN, or
 * the catalogue browsed in full when no specific title is named.
 *
 * Previously a stub — extracted a search term but never actually searched
 * anything, just told the user to go check the library portal themselves.
 */
export async function searchBooks({ message }: HandlerContext): Promise<ChatReply> {
  const searchTerm = extractSearchTerm(message);

  if (!searchTerm || searchTerm.length < 2 || isGenericBrowseResidual(searchTerm)) {
    return browseAllBooks();
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
