'use strict';
// prisma/seed-additions.cjs
// CommonJS seed script — chạy được trong Docker runner (không cần tsx)
// Được gọi tự động khi container khởi động (trước node server.js)

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// In the new architecture with ProfileEndpoint and ExternalApiConnections,
// we no longer use local PREBUILT LLM processors or RECIPE processors.
// Only the basic routing processors are kept if needed.

const ADDITIONAL_PROCESSORS = [];

const RECIPE_PROCESSORS = [];

async function main() {
  console.log('🌱 [seed-additions] Seeding additional processors (now managed via ExternalAPI)...');
  console.log('🎉 [seed-additions] Done. No new local processors needed.');
}

main()
  .catch((err) => {
    console.error('[seed-additions] Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
