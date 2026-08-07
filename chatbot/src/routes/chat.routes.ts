import { Router } from 'express';
import { verifyJwt } from '../middleware/verifyJwt.middleware';
import { chatHandler } from './chat.controller';

export const chatRouter = Router();

// Every chatbot request requires a valid JWT (see src/auth/README.md for
// how this JWT is issued for now, and how to swap it for the real ERP's).
chatRouter.post('/', verifyJwt, chatHandler);
