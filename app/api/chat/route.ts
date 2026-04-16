import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { externalApiConnections } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { SERVICE_REGISTRY } from '@/lib/endpoints/registry';

export async function POST(request: Request) {
  try {
    const { message } = await request.json();
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const [connection] = await db.select().from(externalApiConnections).where(eq(externalApiConnections.slug, 'sys-assistant')).limit(1);

    if (!connection) {
      return NextResponse.json({ error: 'sys-assistant not found in Database' }, { status: 500 });
    }

    // Build available_routes dynamically from registry
    const registryInfo = Object.entries(SERVICE_REGISTRY).map(([catKey, catVal]) => {
      return Object.entries(catVal.subCases || {}).map(([subKey, subVal]) => {
        return `- [${catKey}:${subKey}] ${subVal.displayName}: ${subVal.description}`;
      }).join('\n');
    }).join('\n');

    let prompt = connection.defaultPrompt;
    prompt = prompt.replace('{{available_routes_json}}', registryInfo);
    prompt = prompt.replace('{{user_chat_message}}', message);

    let endpointUrl = connection.endpointUrl;
    // Map localhost to host.docker.internal inside Docker
    if (process.env.UPLOAD_DIR === '/app/uploads' && endpointUrl.includes('localhost')) {
      endpointUrl = endpointUrl.replace('localhost', 'host.docker.internal');
    }

    const formData = new FormData();
    formData.append(connection.promptFieldName || 'query', prompt);
    // Include user_id as some external services require it
    formData.append('user_id', 'sys-assistant');

    if (connection.staticFormFields) {
      try {
        const staticFields = JSON.parse(connection.staticFormFields) as Array<{ key: string; value: string }>;
        for (const field of staticFields) {
          formData.append(field.key, field.value);
        }
      } catch (e) {
        console.warn('Invalid staticFormFields', e);
      }
    }

    const fetchHeaders: Record<string, string> = {
      "accept": "application/json",
    };

    if (connection.authType === 'API_KEY_HEADER' && connection.authKeyHeader) {
      fetchHeaders[connection.authKeyHeader] = connection.authSecret;
    } else if (connection.authType === 'BEARER') {
      fetchHeaders['Authorization'] = `Bearer ${connection.authSecret}`;
    }

    const response = await fetch(endpointUrl, {
      method: connection.httpMethod || "POST",
      headers: fetchHeaders,
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Chat API] External service error:", errText);
      throw new Error(`Failed to fetch from external service: ${response.status}`);
    }

    const data = await response.json();
    
    return NextResponse.json({ response: data.response || "No response" });

  } catch (error: any) {
    console.error("[Chat API] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
