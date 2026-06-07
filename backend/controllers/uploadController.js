/**
 * Upload + processing endpoints.
 * Files are received via multer, persisted, an Upload row is created, and the
 * processing pipeline is enqueued via Bull (Redis) with in-process fallback.
 */
const path = require("path");
const prisma = require("../config/db");
const { enqueueUpload, getQueueStats } = require("../services/queueService");
const { audit } = require("../middleware/audit");

async function createUpload(req, res, next) {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const created = [];
    for (const f of req.files) {
      const upload = await prisma.upload.create({
        data: {
          originalName: f.originalname,
          storedPath: f.path,
          mimeType: f.mimetype,
          sizeBytes: f.size,
          source: req.body.source || null,
          uploadedById: req.user.sub,
          status: "PENDING",
        },
      });
      await audit(req, "UPLOAD_CREATE", "Upload", upload.id, {
        name: f.originalname,
        size: f.size,
      });
      created.push(upload);
    }

    // Enqueue each upload for background OCR processing.
    const jobs = await Promise.all(
      created.map(async (u) => {
        const { jobId, fallback } = await enqueueUpload(u.id);
        return { id: u.id, name: u.originalName, jobId, fallback };
      })
    );

    res.status(202).json({ queued: jobs });
  } catch (e) {
    next(e);
  }
}

async function getUpload(req, res, next) {
  try {
    const upload = await prisma.upload.findUnique({
      where: { id: req.params.id },
      include: { cards: { include: { ocrResult: true, lead: true } } },
    });
    if (!upload) return res.status(404).json({ error: "Not found" });
    res.json(upload);
  } catch (e) {
    next(e);
  }
}

async function listQueue(req, res, next) {
  try {
    const { take = 50, skip = 0, status } = req.query;
    const where = status ? { status } : {};

    const [uploads, total, queueStats] = await Promise.all([
      prisma.upload.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: Math.min(+take, 200),
        skip: +skip,
        include: { _count: { select: { cards: true } } },
      }),
      prisma.upload.count({ where }),
      getQueueStats(),
    ]);

    res.json({ uploads, total, queueStats });
  } catch (e) {
    next(e);
  }
}

module.exports = { createUpload, getUpload, listQueue };
