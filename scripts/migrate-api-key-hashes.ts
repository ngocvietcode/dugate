/**
 * scripts/migrate-api-key-hashes.ts
 *
 * One-time migration: hash all plaintext API keys in the database.
 *
 * Before: keyHash field stored the raw key (e.g. "dg_xxxx...")
 * After:  keyHash field stores SHA-256 hex hash of the raw key
 *
 * IMPORTANT: After running this migration, all existing API key holders must
 * re-authenticate using their original raw key — the validation path now always
 * hashes the incoming key before DB lookup.
 *
 * Run: npx tsx scripts/migrate-api-key-hashes.ts
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;

async function main() {
  console.log('Starting API key hash migration...\n');

  const keys = await prisma.apiKey.findMany({
    select: { id: true, name: true, keyHash: true },
  });

  let skipped = 0;
  let migrated = 0;
  let errors = 0;

  for (const key of keys) {
    // Skip if already a SHA-256 hash (64 hex chars)
    if (SHA256_HEX_REGEX.test(key.keyHash)) {
      console.log(`  SKIP  [${key.id}] "${key.name}" — already hashed`);
      skipped++;
      continue;
    }

    try {
      const newHash = crypto.createHash('sha256').update(key.keyHash).digest('hex');
      await prisma.apiKey.update({
        where: { id: key.id },
        data: { keyHash: newHash },
      });
      console.log(`  DONE  [${key.id}] "${key.name}" — hashed`);
      migrated++;
    } catch (err) {
      console.error(`  ERROR [${key.id}] "${key.name}":`, err);
      errors++;
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);

  if (errors > 0) {
    process.exit(1);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
