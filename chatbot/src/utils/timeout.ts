/**
 * Add timeout to any Promise
 * FIX: Prevents indefinite hangs in SBERT, DB queries, etc.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}
