// scripts/use-mock-endpoints.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Đang cập nhật tất cả ExternalApiConnection sang MOCK SERVICE...');

  const connections = await prisma.externalApiConnection.findMany();

  let updatedCount = 0;
  for (const conn of connections) {
    const mockUrl = `http://mock-service:3099/ext/${conn.slug}`;
    
    // Update to mock URL
    await prisma.externalApiConnection.update({
      where: { id: conn.id },
      data: { 
        endpointUrl: mockUrl,
        authType: 'API_KEY_HEADER',
        authKeyHeader: 'x-api-key',
        authSecret: 'DUMMY_SECRET_KEY'
      }
    });
    
    console.log(`✅ Cập nhật: ${conn.slug} -> ${mockUrl}`);
    updatedCount++;
  }

  console.log(`\n🎉 Hoàn tất! Đã cập nhật ${updatedCount} connectors sang dùng Mock Service.`);
}

main()
  .catch(e => {
    console.error('❌ Lỗi:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
