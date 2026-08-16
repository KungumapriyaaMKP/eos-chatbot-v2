import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';

/**
 * Analyze queries and identify CANDIDATE training examples for retraining.
 *
 * REVIEW GATE: candidates land with approved_at = null (pending review),
 * never auto-approved. This USED to stamp approved_at with the current
 * timestamp at the exact moment of insert — meaning a query the caller
 * themselves marked "correct" (is_correct=true, entirely self-reported, no
 * verification) or a correct_intent someone typed into a feedback form
 * became "approved" training data instantly, with no human ever looking at
 * it. That's a real data-poisoning path: anyone who can hit /chat and
 * /learning/feedback could shape future classifier training just by
 * asserting labels. Candidates are still auto-INSERTED here (that part's
 * fine — it's just data collection) but require an explicit approval step
 * before scripts/merge-approved-training-examples.ts will ever pull them
 * into the real dataset. See scripts/review-training-candidates.ts and
 * scripts/approve-training-candidates.ts.
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
          // Re-occurrence of an already-known candidate: bump usage_count
          // only. Deliberately does NOT touch approved_at either way — if a
          // human already approved this one, seeing it again shouldn't need
          // re-approval; if it's still pending, it stays pending.
          await prisma.training_examples.update({
            where: { id: existing.id },
            data: { usage_count: { increment: 1 } },
          });
        } else {
          await prisma.training_examples.create({
            data: {
              query_text: query.message,
              intent_name: query.correct_intent,
              source: 'user_query',
              confidence: 0.5,
              // approved_at intentionally omitted (stays null = pending review).
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
          // Same non-approval-touching update as the incorrect-predictions
          // branch above — bump usage_count/confidence, leave approved_at
          // as whatever a human already set it to (or hasn't).
          await prisma.training_examples.update({
            where: { id: existing.id },
            data: {
              usage_count: { increment: 1 },
              confidence: query.confidence ? parseFloat(query.confidence.toString()) : 0.85,
            },
          });
        } else {
          await prisma.training_examples.create({
            data: {
              query_text: query.message,
              intent_name: query.intent_detected,
              source: 'user_query',
              confidence: query.confidence ? parseFloat(query.confidence.toString()) : 0.85,
              // approved_at intentionally omitted (stays null = pending review).
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

  // NOT classifier accuracy — this is the % of ALL queries in the window
  // that received an explicit "that was correct" via /learning/feedback,
  // which in practice is a tiny fraction (most queries get no feedback at
  // all). Confirmed live: a real 172-query week reported "Accuracy: 0.00%"
  // when nobody had used /learning/feedback yet — reading as "the bot got
  // everything wrong" when the true story is "nobody rated anything".
  // Kept the underlying accuracy_rate DB column name as-is (a rename is a
  // schema/migration change, out of scope here) but the log line and
  // returned field below are now honest about what this actually measures.
  const correctCount = userCorrect.length;
  const positiveFeedbackRate = total > 0 ? (correctCount / total) * 100 : 0;
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
      accuracy_rate: parseFloat(positiveFeedbackRate.toFixed(2)),
      misclassification_count: incorrect.length,
      avg_confidence: parseFloat(String(avgConfidence)),
      low_confidence_count: lowConfidence.length,
      positive_feedback_pct: parseFloat(positiveFeedbackRate.toFixed(2)),
      new_examples_added: addedCount,
      // NOT an actual automatic retrain — see the review-gate note at the
      // top of this file. This just flags "enough NEW PENDING candidates
      // piled up that a human should go run
      // scripts/review-training-candidates.ts", nothing runs on its own.
      retrain_triggered: addedCount > 10,
    },
  });

  logger.log(
    'model-analyzer',
    `Analysis complete: Added ${addedCount} training examples. ` +
      `${correctCount}/${total} queries had explicit positive feedback (${positiveFeedbackRate.toFixed(2)}%) — ` +
      `not a classifier accuracy measure, most queries get no feedback at all.`,
  );

  return {
    period_days: daysBack,
    total_queries: total,
    low_confidence: lowConfidence.length,
    incorrect_predictions: incorrect.length,
    user_confirmed_correct: userCorrect.length,
    new_training_examples_added: addedCount,
    positive_feedback_percentage: positiveFeedbackRate.toFixed(2),
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
