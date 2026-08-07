import { Router } from 'express';
import { authRouter } from '../auth/auth.routes';
import { chatRouter } from './chat.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter); // TEMPORARY — see src/auth/README.md
apiRouter.use('/chat', chatRouter);
