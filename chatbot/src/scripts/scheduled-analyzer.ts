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
          // NOT an actual retrain — candidates land pending (approved_at =
          // null), see model-analyzer.service.ts's review-gate note. This
          // just flags that enough new PENDING candidates piled up to be
          // worth a human's time reviewing.
          logger.log('scheduler', '⚡ New training candidates ready for review — run: npx tsx scripts/review-training-candidates.ts');
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
