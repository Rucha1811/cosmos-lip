const prisma = require("../config/db");

async function createTestLead(req, res, next) {
  try {
    // Find a READY_FOR_REVIEW upload with a card and no lead
    const upload = await prisma.upload.findFirst({
      where: { status: "READY_FOR_REVIEW" },
      include: { cards: { include: { lead: true, ocrResult: true }, take: 1 } },
    });
    if (!upload || !upload.cards.length) {
      return res.status(400).json({ error: "No suitable upload found" });
    }
    const card = upload.cards[0];
    if (card.lead) {
      return res.json({ message: "Card already has a lead", lead: card.lead });
    }

    // Manually create a lead for this card
    const entities = { companyName: "Test Company" };
    const lead = await prisma.lead.create({
      data: {
        cardId: card.id,
        companyName: "Test Company (from /api/debug/test-lead)",
        email: "test@example.com",
        status: "PENDING_REVIEW",
      },
    });

    res.json({
      message: "Test lead created",
      lead,
      cardId: card.id,
      ocrRawText: card.ocrResult?.rawText?.substring(0, 200) || "no OCR text",
    });
  } catch (e) {
    next(e);
  }
}

async function testTransactionLead(req, res, next) {
  try {
    // Find a card that has no lead
    const upload = await prisma.upload.findFirst({
      where: { status: "READY_FOR_REVIEW", cards: { some: { lead: null } } },
      include: { cards: { where: { lead: null }, take: 1 } },
      orderBy: { createdAt: "desc" },
    });
    if (!upload || !upload.cards.length) {
      return res.status(400).json({ error: "No suitable upload/card found" });
    }
    const card = upload.cards[0];

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const company = await tx.company.upsert({
          where: { normalizedKey: "test-company::test.com" },
          create: { name: "Test Company", normalizedKey: "test-company::test.com", website: "test.com" },
          update: {},
        });
        const lead = await tx.lead.create({
          data: {
            cardId: card.id,
            companyId: company.id,
            companyName: "Test Company (from tx)",
            email: "tx-test@example.com",
            status: "PENDING_REVIEW",
          },
        });
        return { company, lead };
      });
      res.json({
        message: "Transaction succeeded",
        company: result.company,
        lead: result.lead,
        cardId: card.id,
      });
    } catch (txErr) {
      res.status(500).json({
        error: "Transaction failed",
        message: txErr.message,
        stack: txErr.stack?.split("\n").slice(0, 5).join("\n"),
      });
    }
  } catch (e) {
    next(e);
  }
}

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

module.exports = { dbStats, createTestLead, testTransactionLead };
