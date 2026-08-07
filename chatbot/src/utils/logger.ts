/* eslint-disable no-console */

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  log(scope: string, message: string, meta?: unknown): void {
    console.log(`[${timestamp()}] [${scope}] ${message}`, meta ?? '');
  },
  warn(scope: string, message: string, meta?: unknown): void {
    console.warn(`[${timestamp()}] [${scope}] ⚠ ${message}`, meta ?? '');
  },
  error(scope: string, message: string, err?: unknown): void {
    console.error(`[${timestamp()}] [${scope}] ✖ ${message}`, err ?? '');
  },
};
