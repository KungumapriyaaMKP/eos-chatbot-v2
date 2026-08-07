import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/http-error';
import { logger } from '../utils/logger';

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
