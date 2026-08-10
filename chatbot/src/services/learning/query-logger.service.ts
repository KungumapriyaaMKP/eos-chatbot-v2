import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';

export interface QueryLogData {
  userId: number;
  message: string;
  intentDetected?: string;
  confidence?: number;
  isCorrect?: boolean;
  correctIntent?: string;
}

/**
 * Log every query for learning and analytics
 * No blocking - fire and forget to avoid latency impact
 */
export async function logQuery(data: QueryLogData): Promise<void> {
  try {
    await prisma.query_logs.create({
      data: {
        user_id: data.userId,
        message: data.message,
        intent_detected: data.intentDetected,
        confidence: data.confidence ? parseFloat(data.confidence.toFixed(3)) : null,
        is_correct: data.isCorrect,
        correct_intent: data.correctIntent,
        created_at: new Date(),
      },
    });
  } catch (error) {
    // Log error but don't throw - this shouldn't break the chat
    logger.error('query-logger', `Failed to log query: ${error}`);
  }
}

/**
 * Record user feedback (thumbs up/down, rating, notes)
 */
export async function recordFeedback(
  userId: number,
  queryId: number,
  rating: number,
  notes?: string,
): Promise<void> {
  try {
    await prisma.query_logs.update({
      where: { id: queryId },
      data: {
        user_feedback_rating: rating,
        user_notes: notes,
        is_correct: rating >= 4 ? true : rating <= 2 ? false : null,
      },
    });
  } catch (error) {
    logger.error('query-logger', `Failed to record feedback: ${error}`);
  }
}

/**
 * Get statistics for dashboard/analytics
 */
export async function getQueryStats(days: number = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const stats = await prisma.query_logs.findMany({
    where: {
      created_at: { gte: since },
    },
  });

  const total = stats.length;
  const correct = stats.filter((s) => s.is_correct === true).length;
  const incorrect = stats.filter((s) => s.is_correct === false).length;
  const accuracy = total > 0 ? ((correct / total) * 100).toFixed(2) : '0.00';

  const lowConfidence = stats.filter((s) => {
    const conf = parseFloat((s.confidence || 0).toString());
    return conf < 0.60;
  }).length;

  const avgConfidence =
    stats.length > 0
      ? (
          stats.reduce((sum, s) => sum + parseFloat((s.confidence || 0).toString()), 0) /
          stats.length
        ).toFixed(3)
      : '0.000';

  return {
    period_days: days,
    total_queries: total,
    correct_predictions: correct,
    incorrect_predictions: incorrect,
    accuracy_percentage: accuracy,
    low_confidence_count: lowConfidence,
    average_confidence: avgConfidence,
    intents: stats
      .filter((s) => s.intent_detected)
      .reduce(
        (acc, s) => {
          acc[s.intent_detected!] = (acc[s.intent_detected!] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
  };
}
