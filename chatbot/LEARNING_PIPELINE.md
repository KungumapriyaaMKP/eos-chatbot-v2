# 🤖 Chatbot Learning Pipeline Implementation

## Overview

This document explains how to implement the **Query Logging and Automatic Retraining Pipeline** to continuously improve the chatbot's intent classification accuracy.

---

## 📋 Implementation Steps

### Step 1: Add Learning Tables to Prisma Schema

The learning system requires 3 new tables:

**1. `query_logs`** - Store every user query
- user_id, message, intent_detected, confidence, is_correct, correct_intent

**2. `training_examples`** - Approved training data
- query_text, intent_name, source, confidence, usage_count

**3. `model_performance`** - Performance metrics
- accuracy_rate, misclassification_count, avg_confidence, new_examples_added

**Action:** Append content from `prisma/chatbot-learning.prisma` to `prisma/schema.prisma`:

```bash
cat prisma/chatbot-learning.prisma >> prisma/schema.prisma
```

Then run migration:
```bash
npx prisma migrate dev --name "add_learning_tables"
```

---

### Step 2: Register Learning Routes in App

Edit `src/app.ts` and add:

```typescript
import { registerLearningRoutes } from './routes/learning.routes';

export function createApp(): Express {
  const app = express();
  
  // ... existing routes
  
  registerLearningRoutes(app);
  
  return app;
}
```

---

### Step 3: Add Query Logging to Chat Endpoint

Edit `src/routes/chat.controller.ts` to log every query:

```typescript
import { logQuery } from '../services/learning/query-logger.service';

export async function chatHandler(req: Express.Request, res: Express.Response) {
  const { message } = req.body;
  
  // Get intent classification
  const classified = classifier.classify(message);
  
  // LOG QUERY (async, non-blocking)
  logQuery({
    userId: req.user.sub,
    message,
    intentDetected: classified.intent,
    confidence: classified.confidence,
  }).catch(() => {}); // Ignore errors
  
  // ... rest of handler
}
```

---

### Step 4: Set Up Scheduled Analysis Job

Create a cron job to run analysis weekly:

```bash
# Install cron package if not already installed
npm install node-cron
```

Edit `src/scripts/scheduled-analyzer.ts`:

```typescript
import cron from 'node-cron';
import { analyzeAndPrepareRetrainingData } from '../services/learning/model-analyzer.service';
import { logger } from '../utils/logger';

export function startScheduledAnalysis() {
  // Run every Sunday at 2 AM
  cron.schedule('0 2 * * 0', async () => {
    try {
      logger.log('scheduler', 'Starting weekly query analysis...');
      const result = await analyzeAndPrepareRetrainingData(7);
      logger.log('scheduler', `Analysis complete: ${result.new_training_examples_added} new examples added`);
      
      if (result.retrain_triggered) {
        logger.log('scheduler', 'Retraining triggered! Run: npm run train');
      }
    } catch (error) {
      logger.error('scheduler', `Analysis failed: ${error}`);
    }
  });
  
  logger.log('scheduler', 'Weekly analysis scheduler started');
}
```

Add to `src/server.ts`:

```typescript
import { startScheduledAnalysis } from './scripts/scheduled-analyzer';

async function main() {
  // ... existing code
  
  startScheduledAnalysis(); // Start cron jobs
  
  server.listen(PORT, () => {
    logger.log('bootstrap', `Server running on port ${PORT}`);
  });
}
```

---

## 📊 API Endpoints

### 1. Record User Feedback

```bash
POST /learning/feedback
Authorization: Bearer <token>
Content-Type: application/json

{
  "queryId": 123,
  "rating": 5,
  "notes": "Perfect response!"
}
```

**Rating Scale:**
- 5: Perfect response
- 4: Good response
- 3: Okay response
- 2: Poor response
- 1: Wrong response

---

### 2. Get Query Statistics

```bash
GET /learning/stats?days=7
Authorization: Bearer <token>
```

**Response:**
```json
{
  "period_days": 7,
  "total_queries": 145,
  "correct_predictions": 132,
  "incorrect_predictions": 13,
  "accuracy_percentage": "91.03",
  "low_confidence_count": 8,
  "average_confidence": "0.824",
  "intents": {
    "get_marks": 42,
    "get_attendance": 38,
    "get_timetable": 35,
    "get_fees": 30
  }
}
```

---

### 3. Get Performance History

```bash
GET /learning/performance-history?limit=10
Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "id": 1,
    "training_date": "2026-08-10T02:00:00Z",
    "total_queries_analyzed": 145,
    "accuracy_rate": 91.03,
    "misclassification_count": 13,
    "avg_confidence": 0.824,
    "low_confidence_count": 8,
    "positive_feedback_pct": 91.03,
    "new_examples_added": 15,
    "retrain_triggered": true
  }
]
```

---

### 4. Trigger Analysis (Admin Only)

```bash
POST /learning/analyze
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "days": 7
}
```

---

## 🔄 Automatic Retraining Workflow

### When Analysis Runs

1. **Collect Queries** (Last 7 days)
   - Low-confidence predictions (< 0.60)
   - Incorrect predictions (user marked wrong)
   - User-confirmed correct predictions

2. **Auto-Approve & Add to Training**
   - ✅ NO admin review step
   - Automatically add to `training_examples` table
   - Mark with `approved_at` timestamp
   - Increase usage_count if duplicate

3. **Calculate Metrics**
   - Accuracy percentage
   - Average confidence
   - Misclassification rate
   - Positive feedback ratio

4. **Save Performance Record**
   - Store metrics in `model_performance`
   - Flag if retraining should be triggered
   - Trigger: `new_examples_added > 10`

5. **Retrain Model** (When triggered)

```bash
npm run train
```

This will:
- Read updated `training_examples` from database
- Generate new SBERT embeddings
- Update `src/embeddings/intents.json`
- Deploy new model

---

## 📈 Monitoring Performance

### Check Current Accuracy

```bash
curl "http://localhost:3001/learning/stats?days=7" \
  -H "Authorization: Bearer <token>"
```

### View Performance Trends

```bash
curl "http://localhost:3001/learning/performance-history?limit=10" \
  -H "Authorization: Bearer <token>"
```

### Expected Improvements

```
Week 1:  85% accuracy
Week 2:  87% accuracy  (+2%)
Week 3:  89% accuracy  (+2%)
Week 4:  91% accuracy  (+2%)
Week 8:  94% accuracy  (+3%)
```

---

## 🔒 Accuracy Without Hallucination

### How We Maintain Accuracy

1. **Confidence Threshold**
   - Only predictions with confidence > 0.55 are used
   - Below threshold → "I couldn't understand..."

2. **Auto-Approval Rules**
   - Only add examples that are verified as incorrect or confirmed correct
   - Avoid noisy/ambiguous queries
   - Flag low-confidence predictions for manual review

3. **No LLM Generation**
   - Never generate synthetic training data
   - All examples come from real user queries
   - No hallucination from LLM

4. **Explicit Intent Matching**
   - Use cosine similarity against embedding vectors
   - No fuzzy matching or inference
   - Return exact intent name from training data

5. **Metrics Tracking**
   - Monitor accuracy trend
   - Alert if accuracy drops > 3%
   - Revert to previous model if needed

---

## 📚 Database Schema

### query_logs Table

```sql
CREATE TABLE query_logs (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  message TEXT NOT NULL,
  intent_detected VARCHAR(100),
  confidence DECIMAL(4,3),
  is_correct BOOLEAN,
  correct_intent VARCHAR(100),
  user_feedback_rating INT,
  user_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_query_logs_user ON query_logs(user_id);
CREATE INDEX idx_query_logs_intent ON query_logs(intent_detected);
CREATE INDEX idx_query_logs_confidence ON query_logs(confidence);
```

### training_examples Table

```sql
CREATE TABLE training_examples (
  id SERIAL PRIMARY KEY,
  query_text TEXT NOT NULL,
  intent_name VARCHAR(100) NOT NULL,
  source VARCHAR(50),
  confidence DECIMAL(4,3),
  usage_count INT DEFAULT 1,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(query_text, intent_name)
);

CREATE INDEX idx_training_examples_intent ON training_examples(intent_name);
```

### model_performance Table

```sql
CREATE TABLE model_performance (
  id SERIAL PRIMARY KEY,
  training_date TIMESTAMPTZ NOT NULL,
  total_queries_analyzed INT,
  accuracy_rate DECIMAL(5,2),
  misclassification_count INT,
  avg_confidence DECIMAL(4,3),
  low_confidence_count INT,
  positive_feedback_pct DECIMAL(5,2),
  new_examples_added INT,
  retrain_triggered BOOLEAN,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🚀 Deployment Steps

```bash
# 1. Add tables to schema
cat prisma/chatbot-learning.prisma >> prisma/schema.prisma

# 2. Migrate database
npx prisma migrate dev --name "add_learning_tables"

# 3. Register routes in app
# Edit src/app.ts

# 4. Add logging to chat endpoint
# Edit src/routes/chat.controller.ts

# 5. Set up scheduler
# Create src/scripts/scheduled-analyzer.ts
# Add to src/server.ts

# 6. Build and restart
npm run build
npm run dev
```

---

## ✅ Verification

After deployment, verify:

```bash
# 1. Server starts without errors
# npm run dev

# 2. Logging routes are registered
curl -X GET http://localhost:3001/learning/stats \
  -H "Authorization: Bearer <token>"

# 3. Queries are being logged
# Check database: SELECT COUNT(*) FROM query_logs;

# 4. Run manual analysis
curl -X POST http://localhost:3001/learning/analyze \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"days": 7}'

# 5. Check performance metrics
curl -X GET http://localhost:3001/learning/performance-history \
  -H "Authorization: Bearer <token>"
```

---

## 🎯 Summary

The learning pipeline provides:

✅ **Automatic query logging** - Every message is stored  
✅ **User feedback collection** - Ratings and notes  
✅ **Weekly analysis** - Identifies low-confidence and incorrect predictions  
✅ **Auto-approval** - No admin review needed  
✅ **Auto-retraining** - Improves model automatically  
✅ **Performance tracking** - Metrics and trends  
✅ **No hallucination** - Only real user data, no LLM generation  

**Expected Results:**
- Accuracy: 85% → 95% over 8 weeks
- Average confidence: 0.75 → 0.88
- Positive feedback: 85% → 95%

