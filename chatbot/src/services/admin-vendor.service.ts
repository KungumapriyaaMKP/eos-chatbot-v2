import { prisma } from '../utils/prisma';
import { AppError } from '../utils/http-error';
import { markdownTable, type ChatReply } from '../utils/response';
import type { HandlerContext } from '../intent/intent.types';
import { logger } from '../utils/logger';
import { ROLES } from '../config/roles';

/**
 * Admin: Vendor quotations for purchase items.
 */
export async function adminVendorQuotes({ user, message }: HandlerContext): Promise<ChatReply> {
  if (user.role !== ROLES.ADMIN) {
    throw AppError.forbidden('Only admins can view vendor quotations', 'INSUFFICIENT_ROLE');
  }

  try {
    const quotations = await prisma.vendor_quotations.findMany({
      include: {
        vendors: true,
      },
      orderBy: {
        quotation_date: 'desc',
      },
      take: 20,
    });

    if (!quotations || quotations.length === 0) {
      return {
        reply: 'No vendor quotations found in the system.',
        intent: 'admin_vendor_quotes',
        confidence: 1,
      };
    }

    const table = markdownTable(
      ['Vendor', 'Item', 'Price'],
      quotations.map((q) => [
        q.vendors?.name || 'Unknown',
        q.item_description,
        `₹${q.quoted_price}`,
      ]),
    );

    const reply = `Found ${quotations.length} vendor quotations:\n\n${table}`;

    return {
      reply,
      intent: 'admin_vendor_quotes',
      confidence: 1,
      data: { total: quotations.length, quotations },
    };
  } catch (error) {
    logger.error('admin-vendor', `adminVendorQuotes failed for user ${user.sub}: ${error}`);
    if (error instanceof AppError) throw error;
    throw AppError.internal('Failed to fetch vendor quotations');
  }
}
