import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { JwtPayload } from './jwt-payload.interface';

export function signChatbotToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn,
  } as jwt.SignOptions);
}

export function verifyChatbotToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwt.secret) as unknown as JwtPayload;
}
