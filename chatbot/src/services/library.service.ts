import { prisma } from '../utils/prisma';
import { fuzzyFindBest } from '../utils/fuzzy';
import { markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';

/** library_hours — student/faculty/admin. Reads the single library_settings row (same for every caller, no scoping needed). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getLibraryHours(_ctx: HandlerContext): Promise<ChatReply> {
  const settings = await prisma.library_settings.findFirst({
    select: { counter_opens_at: true, counter_closes_at: true },
  });

  if (!settings?.counter_opens_at || !settings?.counter_closes_at) {
    return {
      reply: "I don't have the library's operating hours on record. Please check with the library desk.",
      intent: 'library_hours',
      confidence: 1,
    };
  }

  return {
    reply: `The library counter is open from ${settings.counter_opens_at} to ${settings.counter_closes_at}.`,
    intent: 'library_hours',
    confidence: 1,
    data: settings,
  };
}

/**
 * get_e_resources — student/faculty/admin: real e_resources rows, optionally
 * scoped to a named category. Only publish_state='published' entries are
 * ever shown — e_resources has a draft/published workflow (an uploader's
 * in-progress upload sitting in `publish_state='draft'` isn't a real,
 * available resource yet, the same distinction get_marks/get_exam_schedule
 * already make for unpublished results/timetables).
 */
export async function getEResources({ message }: HandlerContext): Promise<ChatReply> {
  const categories = await prisma.book_categories.findMany({ select: { id: true, name: true } });
  const namedCategory = fuzzyFindBest(message, categories, (c) => ({ name: c.name }));

  const resources = await prisma.e_resources.findMany({
    where: { publish_state: 'published', ...(namedCategory && { category_id: namedCategory.id }) },
    orderBy: { created_at: 'desc' },
    take: 15,
    select: { title: true, url: true, format: true, book_categories: { select: { name: true } } },
  });

  if (resources.length === 0) {
    const scope = namedCategory ? ` in ${namedCategory.name}` : '';
    return { reply: `No e-resources found${scope}.`, intent: 'get_e_resources', confidence: 1 };
  }

  const table = markdownTable(
    ['Title', 'Category', 'Format', 'Link'],
    resources.map((r) => [r.title, r.book_categories?.name ?? '—', r.format ?? '—', r.url]),
  );
  const scope = namedCategory ? ` (${namedCategory.name})` : '';
  return { reply: `E-resources${scope}:\n\n${table}`, intent: 'get_e_resources', confidence: 1, data: resources };
}
