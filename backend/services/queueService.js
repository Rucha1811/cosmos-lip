/**
 * Background Job Queue — Bull (Redis-backed)
 * -------------------------------------------
 * Wraps the OCR processing pipeline in a Bull queue so:
 *   - Upload endpoint responds immediately (202 Accepted)
 *   - Heavy OCR work runs in background workers
 *   - Jobs survive server restarts (persisted in Redis)
 *   - Concurrency is configurable (default: 2 parallel jobs)
 *   - Failed jobs are retried automatically (3 attempts)
 *
 * Falls back to in-process execution if Redis is unavailable,
 * so the app stays functional in dev without Redis.
 */
const Bull = require("bull");
const { processUpload } = require("./processingService");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CONCURRENCY = parseInt(process.env.OCR_CONCURRENCY || "2", 10);

let queue = null;
let _initialized = false;

function getQueue() {
  // Only attempt Redis connection on first actual call, not on require()
  if (_initialized) return queue;
  _initialized = true;

  try {
    queue = new Bull("ocr-processing", REDIS_URL, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,   // keep last 100 completed jobs for debugging
        removeOnFail: 200,
      },
    });

    // Process jobs with configured concurrency
    queue.process(CONCURRENCY, async (job) => {
      const { uploadId } = job.data;
      job.progress(5);
      const result = await processUpload(uploadId);
      job.progress(100);
      return result;
    });

    queue.on("completed", (job, result) => {
      console.log(
        `[Queue] Job ${job.id} completed: upload ${result.uploadId} → ${result.cards} cards, ${result.leadIds?.length} leads`
      );
    });

    queue.on("failed", (job, err) => {
      console.error(`[Queue] Job ${job.id} failed (attempt ${job.attemptsMade}):`, err.message);
    });

    queue.on("error", (err) => {
      console.error("[Queue] Bull error:", err.message);
    });

    console.log(`[Queue] Bull queue initialized (concurrency: ${CONCURRENCY})`);
  } catch (err) {
    console.warn(`[Queue] Redis unavailable (${err.message}) — using in-process fallback`);
    queue = null;
  }

  return queue;
}

/**
 * Enqueue an upload for background processing.
 * Falls back to direct in-process execution if Redis is not available.
 *
 * @param {string} uploadId
 * @returns {Promise<{ jobId: string | null, fallback: boolean }>}
 */
async function enqueueUpload(uploadId) {
  const q = getQueue();

  if (q) {
    try {
      const job = await q.add({ uploadId }, { jobId: uploadId });
      return { jobId: String(job.id), fallback: false };
    } catch (err) {
      console.warn(`[Queue] Failed to enqueue job, falling back: ${err.message}`);
    }
  }

  // Fallback: run in background (fire-and-forget, no retry)
  setImmediate(() => {
    processUpload(uploadId).catch((err) => {
      console.error(`[Queue] In-process fallback failed for ${uploadId}:`, err.message);
    });
  });

  return { jobId: null, fallback: true };
}

/**
 * Get queue statistics for the monitoring dashboard.
 */
async function getQueueStats() {
  const q = getQueue();
  if (!q) return { active: 0, waiting: 0, completed: 0, failed: 0, redis: false };
  const [waiting, active, completed, failed] = await Promise.all([
    q.getWaitingCount(),
    q.getActiveCount(),
    q.getCompletedCount(),
    q.getFailedCount(),
  ]);
  return { waiting, active, completed, failed, redis: true };
}

/**
 * Graceful shutdown — drain the queue before exiting.
 */
async function shutdownQueue() {
  if (queue) {
    await queue.close();
    console.log("[Queue] Bull queue closed");
  }
}

module.exports = { enqueueUpload, getQueueStats, shutdownQueue };
