import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/http-error';
import { logger } from '../utils/logger';

/**
 * Prisma "can't reach the database at all" error codes — as opposed to a
 * query that ran fine but hit a business-logic problem. Seen live: a
 * ~1-minute window where every request failed with P1001 ("Can't reach
 * database server at ...pooler.supabase.com") while the Supabase project
 * was presumably waking from an idle auto-pause, then recovered on its own
 * with no code change. That's infrastructure, not a bug — nothing here can
 * make Supabase respond faster — but it used to surface to users as the
 * exact same generic "Something went wrong. Please try again." as a real
 * server bug, which is needlessly alarming and indistinguishable from one.
 * P1001/P1002/P1008/P1017 are Prisma's own "the database is unreachable/
 * timed out/the connection dropped" codes; see
 * https://www.prisma.io/docs/orm/reference/error-reference.
 */
const DB_UNREACHABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017']);

function isDbUnreachable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && DB_UNREACHABLE_CODES.has(String((err as { code: unknown }).code));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      statusCode: err.statusCode,
      errorCode: err.errorCode,
      message: err.message,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    });
    return;
  }

  if (isDbUnreachable(err)) {
    logger.error('errorHandler', 'Database temporarily unreachable', err);
    res.status(503).json({
      success: false,
      statusCode: 503,
      errorCode: 'DATABASE_UNAVAILABLE',
      message: "Our systems are temporarily unavailable. Please try again in a moment.",
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    });
    return;
  }

  logger.error('errorHandler', 'Unhandled error', err);
  res.status(500).json({
    success: false,
    statusCode: 500,
    errorCode: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  });
}
