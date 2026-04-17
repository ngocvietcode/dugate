import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireProfileAccess } from '@/lib/auth-guard';
import { Logger } from '@/lib/logger';

/**
 * Internal route for testing Profile Endpoints synchronously from the Admin UI.
 * It bypasses the `x-api-key` middleware but injects `x-api-key-id` internally
 * so `runEndpoint` can load per-client overrides correctly.
 */
export async function POST(req: NextRequest) {
  try {
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

    const guard = await requireProfileAccess(apiKeyId);
    if (guard instanceof Response) return guard;

    const session = await getServerSession(authOptions);

    // Remove metadata fields from the payload to avoid polluting the actual service payload
    const testForm = new FormData();
    const entries = Array.from(formData.entries());

    const curlLines = [
      `curl -X POST '${req.nextUrl.origin}/api/v1/${serviceSlug}?sync=true' \\`,
      `  -H "x-api-key: [YOUR_API_KEY]" \\`
    ];

    for (const [key, value] of entries) {
      if (key !== '__service' && key !== '__apiKeyId') {
        testForm.append(key, value);
        
        if (typeof value === 'object' && value !== null && 'name' in value) {
          curlLines.push(`  -F "${key}=@${(value as any).name || 'file'}" \\`);
        } else {
          const safeVal = String(value).replace(/'/g, "'\\''");
          curlLines.push(`  -F "${key}=${safeVal}" \\`);
        }
      }
    }

    new Logger({ service: 'test_profile_endpoint' }).info(`\n==== [TEST ENDPOINT cURL] ====\n${curlLines.join('\n').replace(/ \\$/, '')}\n==============================\n`);

    // Construct a synthetic NextRequest to feed into runEndpoint.
    // We add ?sync=true to force synchronous execution.
    const url = new URL(`/api/v1/${serviceSlug}?sync=true`, req.url);

    // Inject the apiKeyId so the runner knows which Profile to load overrides for
    const headers = new Headers(req.headers);
    if (apiKeyId) headers.set('x-api-key-id', apiKeyId);
    if (session?.user?.id) headers.set('x-user-id', session.user.id);

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
    new Logger({ service: 'test_profile_endpoint' }).error('Admin Test Endpoint Error', undefined, error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
