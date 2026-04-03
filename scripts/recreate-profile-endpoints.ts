

import { PrismaClient } from '@prisma/client';
import { getAllEndpointSlugs } from '../lib/endpoints/registry';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Đang dọn dẹp dữ liệu cũ...');
  
  // 1. Xóa toàn bộ ProfileEndpoint hiện tại của tất cả API Keys
  const deletedEndpoints = await prisma.profileEndpoint.deleteMany({});
  console.log(`🗑️ Đã xóa ${deletedEndpoints.count} ProfileEndpoints cũ.`);

  // 2. Lấy danh sách toàn bộ API Keys
  const apiKeys = await prisma.apiKey.findMany();
  console.log(`🔑 Tìm thấy ${apiKeys.length} API Keys.`);

  // 3. Khởi tạo lại dựa trên SERVICE_REGISTRY
  const allEndpoints = getAllEndpointSlugs();
  let createdCount = 0;

  for (const apiKey of apiKeys) {
    console.log(`\n⚙️ Đang xử lý API Key: ${apiKey.name} (${apiKey.id})`);
    
    // Tạo mảng dữ liệu để insert hàng loạt cho key này
    const insertions = allEndpoints.map(ep => ({
      apiKeyId: apiKey.id,
      endpointSlug: ep.slug,
      enabled: true,
      parameters: null,
    }));

    const result = await prisma.profileEndpoint.createMany({
      data: insertions,
      skipDuplicates: true
    });
    
    createdCount += result.count;
    console.log(`  └─ Đã khởi tạo ${result.count} Endpoints (theo kiến trúc 6-Service chuẩn mới).`);
  }

  console.log(`\n✅ Hoàn tất! Đã tạo tổng cộng ${createdCount} bản ghi ProfileEndpoint mới.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
