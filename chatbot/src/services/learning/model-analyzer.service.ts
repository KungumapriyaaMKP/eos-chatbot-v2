import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';

/**
 * Analyze queries and identify candidates for retraining
 * No admin review - auto-approve if confidence is correct
 */
export async function analyzeAndPrepareRetrainingData(daysBack: number = 7) {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  logger.log('model-analyzer', `Analyzing queries from last ${daysBack} days...`);

  // Find low-confidence predictions
  const lowConfidence = await prisma.query_logs.findMany({
    where: {
      created_at: { gte: since },
      confidence: { lt: 0.60 },
      intent_detected: { not: null },
    },
    orderBy: { confidence: 'asc' },
  });

  // Find incorrect predictions
  const incorrect = await prisma.query_logs.findMany({
    where: {
      created_at: { gte: since },
      is_correct: false,
      correct_intent: { not: null },
    },
  });

  // Find user-marked correct predictions (for reinforcement)
  const userCorrect = await prisma.query_logs.findMany({
    where: {
      created_at: { gte: since },
      is_correct: true,
      intent_detected: { not: null },
    },
  });

  logger.log('model-analyzer', `Found ${lowConfidence.length} low-confidence queries`);
  logger.log('model-analyzer', `Found ${incorrect.length} incorrect predictions`);
  logger.log('model-analyzer', `Found ${userCorrect.length} user-confirmed correct predictions`);

  // Auto-add to training examples (NO admin review)
  let addedCount = 0;

  // Add incorrect predictions with correct intent
  for (const query of incorrect) {
    if (query.message && query.correct_intent) {
      try {
        const existing = await prisma.training_examples.findFirst({
          where: {
            query_text: query.message,
            intent_name: query.correct_intent,
          },
        });

        if (existing) {
          await prisma.training_examples.update({
            where: { id: existing.id },
            data: {
              usage_count: { increment: 1 },
              approved_at: new Date(),
            },
          });
        } else {
          await prisma.training_examples.create({
            data: {
              query_text: query.message,
              intent_name: query.correct_intent,
              source: 'user_query',
              confidence: 0.5,
              approved_at: new Date(),
            },
          });
        }
        addedCount++;
      } catch (error) {
        logger.error('model-analyzer', `Failed to add training example: ${error}`);
      }
    }
  }

  // Add user-confirmed correct predictions (for reinforcement)
  for (const query of userCorrect) {
    if (query.message && query.intent_detected) {
      try {
        const existing = await prisma.training_examples.findFirst({
          where: {
            query_text: query.message,
            intent_name: query.intent_detected,
          },
        });

        if (existing) {
          await prisma.training_examples.update({
            where: { id: existing.id },
            data: {
              usage_count: { increment: 1 },
              confidence: query.confidence ? parseFloat(query.confidence.toString()) : 0.85,
              approved_at: new Date(),
            },
          });
        } else {
          await prisma.training_examples.create({
            data: {
              query_text: query.message,
              intent_name: query.intent_detected,
              source: 'user_query',
              confidence: query.confidence ? parseFloat(query.confidence.toString()) : 0.85,
              approved_at: new Date(),
            },
          });
        }
        addedCount++;
      } catch (error) {
        logger.error('model-analyzer', `Failed to add training example: ${error}`);
      }
    }
  }

  // Calculate metrics
  const total = await prisma.query_logs.count({
    where: { created_at: { gte: since } },
  });

  const correctCount = userCorrect.length;
  const accuracy = total > 0 ? (correctCount / total) * 100 : 0;
  const avgConfidence =
    total > 0
      ? (
          (await prisma.query_logs.aggregate({
            where: { created_at: { gte: since } },
            _avg: { confidence: true },
          }))._avg.confidence || 0
        ).toFixed(3)
      : '0.000';

  // Save performance metrics
  await prisma.model_performance.create({
    data: {
      training_date: new Date(),
      total_queries_analyzed: total,
      accuracy_rate: parseFloat(accuracy.toFixed(2)),
      misclassification_count: incorrect.length,
      avg_confidence: parseFloat(String(avgConfidence)),
      low_confidence_count: lowConfidence.length,
      positive_feedback_pct: total > 0 ? parseFloat(((correctCount / total) * 100).toFixed(2)) : 0,
      new_examples_added: addedCount,
      retrain_triggered: addedCount > 10, // Trigger retrain if more than 10 new examples
    },
  });

  logger.log(
    'model-analyzer',
    `Analysis complete: Added ${addedCount} training examples. Accuracy: ${accuracy.toFixed(2)}%`,
  );

  return {
    period_days: daysBack,
    total_queries: total,
    low_confidence: lowConfidence.length,
    incorrect_predictions: incorrect.length,
    user_confirmed_correct: userCorrect.length,
    new_training_examples_added: addedCount,
    accuracy_percentage: accuracy.toFixed(2),
    average_confidence: avgConfidence,
    retrain_triggered: addedCount > 10,
  };
}

/**
 * Get model performance history
 */
export async function getModelPerformanceHistory(limit: number = 10) {
  return prisma.model_performance.findMany({
    orderBy: { training_date: 'desc' },
    take: limit,
  });
}
