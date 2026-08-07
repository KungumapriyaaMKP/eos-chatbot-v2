import type { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { AppError } from '../utils/http-error';

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body ?? {};

    if (typeof email !== 'string' || !email.includes('@')) {
      throw AppError.badRequest('Please provide a valid email address');
    }
    if (typeof password !== 'string' || password.length < 6) {
      throw AppError.badRequest('Password must be at least 6 characters');
    }

    const result = await authService.login(email, password);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}
