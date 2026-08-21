import type { Request, Response, NextFunction } from 'express';

/**
 * A minimal, dependency-free fixed-window rate limiter — one in-memory Map,
 * keyed by whatever the caller's `keyFn` returns, counting requests per
 * 60-second window. Extracted from app.ts's original inline IP-based
 * limiter (FIX #4) into a reusable factory so the same mechanism can be
 * applied with a DIFFERENT key — e.g. per-authenticated-user instead of
 * per-IP, see rbac.middleware.ts's sibling concern and
 * `perUserChatRateLimit` in this same file — without duplicating the
 * counting/cleanup logic a second time.
 */
export function createRateLimit(opts: { max: number; keyFn: (req: Request) => string | null }) {
  const { max, keyFn } = opts;
  const hits = new Map<string, number>();

  setInterval(() => {
    const now = Math.floor(Date.now() / 60000);
    for (const key of hits.keys()) {
      const entryWindow = parseInt(key.slice(key.lastIndexOf(':') + 1), 10);
      if (now - entryWindow > 2) hits.delete(key);
    }
  }, 60000);

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const identity = keyFn(req);
    if (identity === null) return next(); // nothing to key on (e.g. unauthenticated route with a per-user limiter) — skip, not fail open on the WHOLE request

    const key = `${identity}:${Math.floor(Date.now() / 60000)}`;
    const count = (hits.get(key) || 0) + 1;
    hits.set(key, count);
    if (count > max) {
      // Same envelope shape as errorHandler.middleware.ts (success/
      // statusCode/errorCode/message) -- this used to be a bare
      // { error: 'Rate limit exceeded' }, a different shape from every
      // other error response in this app, so the frontend's shared
      // `body.message` handling couldn't surface it as anything but the
      // generic "Something went wrong" fallback.
      return res.status(429).json({
        success: false,
        statusCode: 429,
        errorCode: 'RATE_LIMITED',
        message: "You're sending messages a bit too quickly. Please wait a moment and try again.",
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
      });
    }
    next();
  };
}
