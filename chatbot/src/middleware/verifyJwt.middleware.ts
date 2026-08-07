import type { Request, Response, NextFunction } from 'express';
import { verifyChatbotToken } from '../auth/jwt.util';
import { AppError } from '../utils/http-error';

/**
 * Requires a valid `Authorization: Bearer <token>` header on every request.
 * Attaches the decoded payload to req.user.
 *
 * This is the ONLY place that knows the token comes from src/auth (the
 * temporary login). Everything downstream just reads req.user. See
 * src/auth/README.md for how to swap this out for the real ERP's auth.
 */
export function verifyJwt(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return next(AppError.unauthorized('Access token is missing or invalid'));
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    req.user = verifyChatbotToken(token);
    next();
  } catch {
    next(AppError.unauthorized('Access token is missing or invalid'));
  }
}
