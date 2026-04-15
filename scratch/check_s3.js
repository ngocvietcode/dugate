const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.appSetting.findMany({ where: { key: { startsWith: 's3_' } } })
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => console.error(e.message))
  .finally(() => p.$disconnect());
