import { Router } from 'express';
import { verifyJwt } from '../middleware/verifyJwt.middleware';
import { recordFeedback, getQueryStats } from '../services/learning/query-logger.service';
import { analyzeAndPrepareRetrainingData, getModelPerformanceHistory } from '../services/learning/model-analyzer.service';
import { logger } from '../utils/logger';

export const learningRouter = Router();

/**
 * POST /learning/feedback
 * Record user feedback on a query
 */
learningRouter.post('/feedback', verifyJwt, async (req, res) => {
    try {
      const { queryId, rating, notes } = req.body;

      if (!queryId || !rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Invalid queryId or rating (1-5)' });
      }

      await recordFeedback(req.user!.sub, queryId, rating, notes);

      logger.log('learning', `Feedback recorded: query ${queryId}, rating ${rating}`);

      res.json({ success: true, message: 'Feedback recorded' });
    } catch (error) {
      logger.error('learning', `Feedback error: ${error}`);
      res.status(500).json({ error: 'Failed to record feedback' });
    }
  });

/**
 * GET /learning/stats
 * Get query statistics (last 7 days by default)
 */
learningRouter.get('/stats', verifyJwt, async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const stats = await getQueryStats(days);

      res.json(stats);
    } catch (error) {
      logger.error('learning', `Stats error: ${error}`);
      res.status(500).json({ error: 'Failed to get stats' });
    }
  });

/**
 * GET /learning/performance-history
 * Get model performance metrics
 */
learningRouter.get('/performance-history', verifyJwt, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const history = await getModelPerformanceHistory(limit);

      res.json(history);
    } catch (error) {
      logger.error('learning', `Performance history error: ${error}`);
      res.status(500).json({ error: 'Failed to get performance history' });
    }
  });

/**
 * POST /learning/analyze
 * Trigger analysis and retraining data preparation (admin only)
 */
learningRouter.post('/analyze', verifyJwt, async (req, res) => {
    try {
      // Check if user is admin
      if (req.user!.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const days = parseInt(req.body.days as string) || 7;
      const result = await analyzeAndPrepareRetrainingData(days);

      logger.log('learning', `Analysis completed: ${result.new_training_examples_added} new examples added`);

      res.json(result);
    } catch (error) {
      logger.error('learning', `Analysis error: ${error}`);
      res.status(500).json({ error: 'Failed to analyze queries' });
    }
  });
