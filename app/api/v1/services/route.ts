import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAllEndpointSlugs } from '@/lib/endpoints/registry';

export async function GET(req: NextRequest) {
  // Middleware should have verified the API Key and injected its ID into headers
  const apiKeyId = req.headers.get('x-api-key-id');

  if (!apiKeyId) {
    return NextResponse.json(
      { 
        type: 'https://dugate.vn/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Hệ thống không nhận diện được API Key từ Request Header.' 
      }, 
      { status: 401 }
    );
  }

  try {
    // Lấy config từ ProfileEndpoint của API Key này, để biết những service nào bị OFF
    const profileEndpoints = await prisma.profileEndpoint.findMany({ 
      where: { apiKeyId } 
    });

    const allSlugs = getAllEndpointSlugs();
    
    // Group endpoints by generic Service (e.g. ingest, extract)
    const activeServices: Record<string, any> = {};

    for (const ep of allSlugs) {
      // Check if this endpoint is explicitly disabled
      const dbRecord = profileEndpoints.find((p) => p.endpointSlug === ep.slug);
      
      // Check for generic wildcard disable (e.g. 'extract' is off means 'extract:invoice' is off)
      const genericRecord = profileEndpoints.find((p) => p.endpointSlug === ep.serviceSlug);

      if (dbRecord?.enabled === false || genericRecord?.enabled === false) {
         continue; // Bỏ qua vì Admin đã khóa quyền này
      }

      if (!activeServices[ep.serviceSlug]) {
        activeServices[ep.serviceSlug] = {
          serviceId: ep.serviceSlug,
          serviceName: ep.serviceName,
          discriminatorKey: ep.discriminatorName,
          subCases: []
        };
      }

      activeServices[ep.serviceSlug].subCases.push({
        id: ep.discriminatorValue || '_default',
        displayName: ep.displayName,
        description: ep.description,
        clientParameters: ep.clientParamsSchema, 
      });
    }

    return NextResponse.json(
      { 
        status: 200, 
        message: 'Lấy danh sách các dịch vụ AI khả dụng thành công.',
        services: Object.values(activeServices) 
      }, 
      { status: 200 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[GET /api/v1/services]', msg);
    return NextResponse.json(
      { type: 'https://dugate.vn/errors/internal', title: 'Internal Server Error', status: 500, detail: msg }, 
      { status: 500 }
    );
  }
}
