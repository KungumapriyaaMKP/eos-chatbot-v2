import type { JwtPayload } from '../auth/jwt-payload.interface';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export {};
