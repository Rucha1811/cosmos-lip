require("dotenv").config();
const { app } = require("./app");
const prisma = require("./config/db");
const { shutdownQueue } = require("./services/queueService");

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  console.log(`Cosmos backend listening on :${PORT} [${process.env.NODE_ENV || "development"}]`);
});

async function shutdown(signal) {
  console.log(`Received ${signal} — shutting down gracefully`);
  server.close(async () => {
    await shutdownQueue();
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
