const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Count all operations (including soft-deleted)
  const count = await p.operation.count();
  console.log(`Total operations: ${count}`);

  // Get the last 5 (including soft-deleted)
  const ops = await p.$queryRaw`SELECT id, state, "filesJson", "endpointSlug", "createdAt", "deletedAt" FROM "Operation" ORDER BY "createdAt" DESC LIMIT 5`;
  
  for (const op of ops) {
    console.log(`\n=== Operation ${op.id} ===`);
    console.log(`  State: ${op.state}`);
    console.log(`  Endpoint: ${op.endpointSlug}`);
    console.log(`  Created: ${op.createdAt}`);
    console.log(`  Deleted: ${op.deletedAt}`);
    if (op.filesJson) {
      const files = JSON.parse(op.filesJson);
      console.log(`  Files (${files.length}):`);
      files.forEach(f => {
        console.log(`    - name: ${f.name}`);
        console.log(`      path: ${f.path}`);
        console.log(`      s3Key: ${f.s3Key || 'N/A'}`);
        console.log(`      size: ${f.size}`);
        console.log(`      url: ${f.url || 'N/A'}`);
        console.log(`      isRemoteUrl: ${f.isRemoteUrl || false}`);
      });
    } else {
      console.log('  Files: none');
    }
  }

  // Also check FileCache
  const cacheCount = await p.fileCache.count();
  console.log(`\n\nFileCache entries: ${cacheCount}`);
  if (cacheCount > 0) {
    const caches = await p.fileCache.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
    caches.forEach(c => {
      console.log(`  - ${c.id}: ${c.originalName} | s3Key: ${c.s3Key} | size: ${c.size}`);
    });
  }
}

main().catch(console.error).finally(() => p.$disconnect());
