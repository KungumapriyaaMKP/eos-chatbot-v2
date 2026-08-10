import cron from 'node-cron';
import { analyzeAndPrepareRetrainingData } from '../services/learning/model-analyzer.service';
import { logger } from '../utils/logger';

export function startScheduledAnalysis() {
  try {
    // Run every Sunday at 2 AM
    cron.schedule('0 2 * * 0', async () => {
      try {
        logger.log('scheduler', 'Starting weekly query analysis...');
        const result = await analyzeAndPrepareRetrainingData(7);
        logger.log(
          'scheduler',
          `Analysis complete: ${result.new_training_examples_added} new examples added. Accuracy: ${result.accuracy_percentage}%`,
        );

        if (result.retrain_triggered) {
          logger.log('scheduler', '⚡ Retraining triggered! Run: npm run train');
        }
      } catch (error) {
        logger.error('scheduler', `Analysis failed: ${error}`);
      }
    });

    logger.log('scheduler', '✅ Weekly analysis scheduler started (every Sunday 2 AM)');
  } catch (error) {
    logger.error('scheduler', `Failed to start scheduler: ${error}`);
  }
}
