const prisma = require("../config/db");

async function dbStats(req, res, next) {
  try {
    const [uploads, cards, ocrResults, leads, companies, contacts, users] =
      await Promise.all([
        prisma.upload.findMany({
          select: { id: true, status: true, originalName: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
        prisma.card.count(),
        prisma.ocrResult.count(),
        prisma.lead.count(),
        prisma.company.count(),
        prisma.contact.count(),
        prisma.user.count(),
      ]);

    const statusCounts = {};
    for (const u of uploads) {
      statusCounts[u.status] = (statusCounts[u.status] || 0) + 1;
    }

    const uploadsWithLeads = uploads.filter(
      (u) => u.status === "READY_FOR_REVIEW"
    ).length;
    const recentUploads = uploads.slice(0, 5).map((u) => ({
      id: u.id,
      name: u.originalName,
      status: u.status,
      createdAt: u.createdAt,
    }));

    res.json({
      counts: {
        uploads: uploads.length,
        cards,
        ocrResults,
        leads,
        companies,
        contacts,
        users,
      },
      statusBreakdown: statusCounts,
      readyForReviewCount: uploadsWithLeads,
      leadGap: { readyForReview: uploadsWithLeads, leadsCreated: leads },
      recentUploads,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { dbStats };
