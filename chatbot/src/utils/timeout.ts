/**
 * Add timeout to any Promise
 * FIX: Prevents indefinite hangs in SBERT, DB queries, etc.
 *
 * Clears the timeout's timer as soon as `promise` settles either way —
 * without this, every call (including every ordinary successful one) left
 * its setTimeout running for the FULL timeoutMs regardless, since
 * Promise.race never cancels the loser. Harmless for a single call, but
 * this runs on every intent classification and every Ollama call — at real
 * request volume that's a steadily growing pile of live timer handles
 * doing nothing but waiting to fire into the void, not a true memory leak
 * (they do eventually fire and get GC'd) but needless event-loop upkeep.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
