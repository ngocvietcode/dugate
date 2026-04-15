const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.fileCache.findMany()
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => console.error(e))
  .finally(() => p.$disconnect());
