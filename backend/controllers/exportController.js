const prisma = require("../config/db");
const { generateExport } = require("../services/exportService");
const { audit } = require("../middleware/audit");

async function buildAndStream(req, res, next, format) {
  try {
    // Always export ALL approved leads matching the (optional) filter.
    const where = { status: "APPROVED" };
    if (req.query.source) where.source = req.query.source;

    const leads = await prisma.lead.findMany({
      where,
      include: { contacts: true, company: true },
      orderBy: { createdAt: "asc" },
    });

    const { filePath, fileName, rowCount } = await generateExport(leads, format, {
      salesBranchBySource: {}, // configurable mapping event->branch
    });

    const exportRow = await prisma.export.create({
      data: {
        format, storedPath: filePath, leadCount: rowCount,
        filters: where, createdById: req.user?.sub || 'anonymous',
      },
    });
    if (req.user) {
      await audit(req, `EXPORT_${format}`, "Export", exportRow.id, { rowCount });
    }

    res.download(filePath, fileName);
  } catch (e) { next(e); }
}

module.exports = {
  csv: (req, res, next) => buildAndStream(req, res, next, "CSV"),
  xlsx: (req, res, next) => buildAndStream(req, res, next, "XLSX"),
  json: (req, res, next) => buildAndStream(req, res, next, "JSON"),
};
