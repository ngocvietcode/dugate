import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // fallback

if (process.env.DATABASE_URL?.includes('@db:')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@db:', '@localhost:');
}

const prisma = new PrismaClient();

// The unhashed key we use in all e2e requests
export const E2E_API_KEY = 'dg_test_key_e2e_12345';
const e2eKeyHash = crypto.createHash('sha256').update(E2E_API_KEY).digest('hex');

beforeAll(async () => {
  console.log('[E2E Setup] Preparing Database...');

  // 1. Ensure test API key is inserted
  await prisma.apiKey.upsert({
    where: { keyHash: e2eKeyHash },
    update: {},
    create: {
      name: 'E2E Test Key',
      keyHash: e2eKeyHash,
      prefix: 'dg_test_',
      role: 'ADMIN',
      status: 'active',
      spendingLimit: 1000,
    },
  });

  // 2. We can seed specific ExternalApiConnection if missing, but usually 
  // DUGate comes with default ones pointing to `http://mock-service` via env vars or manual DB config.
  // Here we just rely on whatever is in the local DB. If you need to force override to mock-service:
  // (Optional: Ensure all ExternalApiConnections point to mock-service in integration testing environment)
  
  console.log('[E2E Setup] Database Ready.');
});

afterAll(async () => {
  await prisma.$disconnect();
});
