import crypto from 'node:crypto';

/**
 * Identical scheme to EOS-backend's src/auth/auth.service.ts — sha256 hex
 * digest compared against `users.password_hash`. Duplicated as a two-line
 * pure function (not "business logic") purely because the chatbot is a
 * separate process/repo with no import path into EOS-backend's source.
 * If EOS-backend ever changes its hashing scheme, this must change too.
 */
export function hashPassword(plainText: string): string {
  return crypto.createHash('sha256').update(plainText).digest('hex');
}

/**
 * Constant-time comparison of two hex digests — auth.service.ts previously
 * compared hashPassword(password) !== user.password_hash with plain string
 * `!==`, which is NOT timing-safe (V8 string equality can short-circuit on
 * the first differing byte). A textbook timing side-channel: an attacker
 * measuring response-time variance across many attempts could in principle
 * narrow down a hash byte-by-byte. crypto.timingSafeEqual takes the same
 * time regardless of where the buffers first differ.
 *
 * timingSafeEqual throws on mismatched buffer lengths rather than
 * returning false, so a length check must happen first — but note that
 * check is itself NOT constant-time. That's the standard, accepted
 * trade-off here (used by bcrypt/scrypt implementations too): a length
 * mismatch leaks far less than a byte-by-byte content comparison would,
 * since sha256 hex digests are always a fixed 64 characters for a
 * well-formed hash — length only varies for a malformed/corrupt stored
 * hash, not attacker-controlled input.
 */
export function verifyPassword(plainText: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashPassword(plainText), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}
