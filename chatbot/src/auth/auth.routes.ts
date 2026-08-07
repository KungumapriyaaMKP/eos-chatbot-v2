import { Router } from 'express';
import { loginHandler } from './auth.controller';

/**
 * TEMPORARY auth routes — see src/auth/README.md.
 * Mounted at /auth by src/app.ts.
 */
export const authRouter = Router();

authRouter.post('/login', loginHandler);
