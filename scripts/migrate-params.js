const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrate() {
  console.log('Starting migration...');
  const profiles = await prisma.profileEndpoint.findMany();
  
  let migratedCount = 0;
  
  for (const profile of profiles) {
    let newParams = {};
    let needsUpdate = false;

    if (profile.defaultParams) {
      try {
        const defParams = JSON.parse(profile.defaultParams);
        for (const [k, v] of Object.entries(defParams)) {
          newParams[k] = { value: v, isLocked: false };
        }
        needsUpdate = true;
      } catch (e) {
        console.error(`Invalid defaultParams for ID ${profile.id}:`, e.message);
      }
    }

    if (profile.profileParams) {
      try {
        const profParams = JSON.parse(profile.profileParams);
        for (const [k, v] of Object.entries(profParams)) {
          newParams[k] = { value: v, isLocked: true };
        }
        needsUpdate = true;
      } catch (e) {
        console.error(`Invalid profileParams for ID ${profile.id}:`, e.message);
      }
    }

    if (needsUpdate || Object.keys(newParams).length > 0) {
      await prisma.profileEndpoint.update({
        where: { id: profile.id },
        data: { parameters: JSON.stringify(newParams) }
      });
      migratedCount++;
      console.log(`Migrated profile ID ${profile.id}`);
    }
  }

  console.log(`Migration complete. Updated ${migratedCount} records.`);
}

migrate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
