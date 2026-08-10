import { logger } from './logger';

/**
 * Retry a function with exponential backoff on timeout errors
 * Useful for database queries that might temporarily fail
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 100,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if error is timeout-related
      const isTimeoutError =
        (error instanceof Error && error.message.includes('ETIMEDOUT')) ||
        (error instanceof Error && error.message.includes('timeout')) ||
        (error as any)?.code === 'ETIMEDOUT';

      if (!isTimeoutError || attempt === maxRetries) {
        throw error;
      }

      // Calculate exponential backoff: 100ms, 200ms, 400ms
      const delayMs = initialDelayMs * Math.pow(2, attempt - 1);

      logger.warn(
        'retry',
        `Attempt ${attempt}/${maxRetries} failed with timeout. Retrying in ${delayMs}ms...`,
      );

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * Example usage in a service:
 *
 * import { retryWithBackoff } from '../utils/retry';
 *
 * export async function adminListFaculty(...) {
 *   return retryWithBackoff(async () => {
 *     const total = await prisma.faculty.count();
 *     const rows = await prisma.faculty.findMany();
 *     return { total, rows };
 *   });
 * }
 */
