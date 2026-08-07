import { prisma } from '../utils/prisma';
import type { ChatReply } from '../utils/response';
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
