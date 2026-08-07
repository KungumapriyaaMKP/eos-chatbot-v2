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
