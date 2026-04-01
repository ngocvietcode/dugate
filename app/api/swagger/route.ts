import { getAllEndpointSlugs } from '@/lib/endpoints/registry';

export async function GET() {
  const allEndpoints = getAllEndpointSlugs();

  const paths: any = {};
  
  // Group logic by base route e.g. /api/v1/extract
  const groupedKeys = ['ingest', 'extract', 'analyze', 'transform', 'generate', 'compare'];

  for (const group of groupedKeys) {
     const routeEndpoints = allEndpoints.filter(e => e.serviceSlug === group);
     if (routeEndpoints.length === 0) continue;
     
     const serviceName = routeEndpoints[0].serviceName;
     const discriminator = routeEndpoints[0].discriminatorName;

     paths[`/api/v1/${group}`] = {
       post: {
         summary: serviceName,
         description: `Bao gồm các chức năng con: ${routeEndpoints.map(e => e.displayName).join(', ')}`,
         tags: [group],
         security: [{ ApiKeyAuth: [] }],
         requestBody: {
           required: true,
           content: {
             'multipart/form-data': {
               schema: {
                 type: 'object',
                 required: ['file', discriminator],
                 properties: {
                   file: {
                     type: 'string',
                     format: 'binary',
                     description: 'Tài liệu đầu vào cần xử lý'
                   },
                   [discriminator]: {
                     type: 'string',
                     enum: routeEndpoints.map(e => e.discriminatorValue || '_default'),
                     description: `Bộ định tuyến sub-case tương ứng của API`
                   },
                   // Merge all possible client params for documentation purposes
                   ...routeEndpoints.reduce((acc, ep) => {
                      Object.entries(ep.clientParamsSchema || {}).forEach(([key, val]: [string, any]) => {
                         acc[key] = {
                            type: val.type,
                            description: val.description,
                            ...(val.options ? { enum: val.options } : {}),
                            ...(val.default !== undefined ? { default: val.default } : {})
                         };
                      });
                      return acc;
                   }, {} as any)
                 }
               }
             }
           }
         },
         responses: {
           '202': { description: 'Operation Accepted' },
           '400': { description: 'Bad Request' },
           '401': { description: 'Unauthorized' },
           '403': { description: 'Endpoint Disabled' },
           '500': { description: 'Internal Server Error' }
         }
       }
     };
  }

  // Prepend other generic API paths
  paths['/api/v1/operations'] = {
     get: {
        summary: 'List Operations',
        tags: ['operations'],
        security: [{ ApiKeyAuth: [] }],
        responses: { '200': { description: 'List of operations' } }
     }
  };
  paths['/api/v1/operations/{id}'] = {
     get: {
        summary: 'Get Operation',
        tags: ['operations'],
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Operation status and results' } }
     },
     delete: {
        summary: 'Delete Operation',
        tags: ['operations'],
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Operation deleted' } }
     }
  };

  const spec = {
    openapi: '3.0.0',
    info: {
      title: 'DUGATE - Document AI API v3',
      version: '1.0.0',
      description: 'API xử lý tài liệu đa luồng dùng AI Pipelines. Truy cập endpoint `/api/v1/services` để xem chi tiết Param.',
    },
    servers: [
      { url: 'http://localhost:2023', description: 'Local Development' },
      { url: 'https://api.dugate.vn', description: 'Production API' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    paths,
  };

  return Response.json(spec);
}
