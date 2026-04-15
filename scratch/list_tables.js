const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.$queryRaw`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`
  .then(r => console.log(r))
  .catch(e => console.error(e))
  .finally(() => p.$disconnect());
