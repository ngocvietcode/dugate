import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

/**
 * Internal route for testing Profile Endpoints synchronously from the Admin UI.
 * It bypasses the `x-api-key` middleware but injects `x-api-key-id` internally
 * so `runEndpoint` can load per-client overrides correctly.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'ADMIN') {
      return new Response(JSON.stringify({ error: 'Unauthorized: Admin access required.' }), { 
        status: 403, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    const formData = await req.formData();
    
    // Extract hidden internal metadata fields provided by the admin UI
    const serviceSlug = formData.get('__service') as string;
    const apiKeyId = formData.get('__apiKeyId') as string;

    if (!serviceSlug || !apiKeyId) {
      return new Response(JSON.stringify({ error: 'Missing required test parameters (__service, __apiKeyId)' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    // Remove metadata fields from the payload to avoid polluting the actual service payload
    const testForm = new FormData();
    const entries = Array.from(formData.entries());
    for (const [key, value] of entries) {
      if (key !== '__service' && key !== '__apiKeyId') {
        testForm.append(key, value);
      }
    }

    // Construct a synthetic NextRequest to feed into runEndpoint.
    // We add ?sync=true to force synchronous execution.
    const url = new URL(`/api/v1/${serviceSlug}?sync=true`, req.url);
    
    // Inject the apiKeyId so the runner knows which Profile to load overrides for
    const headers = new Headers(req.headers);
    if (apiKeyId) headers.set('x-api-key-id', apiKeyId);
    
    // Remove content-type and content-length because the new FormData body 
    // will generate its own boundary and length.
    headers.delete('content-type');
    headers.delete('content-length');

    const syntheticReq = new NextRequest(url, {
      method: 'POST',
      headers,
      body: testForm,
      // @ts-ignore - duplex is needed by Next.js edge runtime for custom streams
      duplex: 'half'
    });

    // runEndpoint handles everything (Params merge -> DB Operations -> execute pipeline -> format result)
    // Thanks to `?sync=true`, it will await pipeline completion and return the 200 JSON directly.
    return runEndpoint(serviceSlug, syntheticReq);

  } catch (error: Omit<Error, "stack"> | unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Admin Test Endpoint Error]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' }});
  }
}
