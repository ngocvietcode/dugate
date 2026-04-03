const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function clean() {
  const eps = await prisma.profileEndpoint.findMany({ where: { parameters: { not: null } } });
  let count = 0;
  for (const ep of eps) {
    let params = JSON.parse(ep.parameters);
    if (params && params.business_rules) {
      delete params.business_rules;
      await prisma.profileEndpoint.update({ 
        where: { id: ep.id }, 
        data: { parameters: Object.keys(params).length === 0 ? null : JSON.stringify(params) } 
      });
      count++;
    }
  }
  console.log('Cleaned', count, 'records from DB');
}
clean().then(() => prisma.$disconnect());
