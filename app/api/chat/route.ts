import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SERVICE_REGISTRY } from '@/lib/endpoints/registry';

export async function POST(request: Request) {
  try {
    const { message } = await request.json();
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const connection = await prisma.externalApiConnection.findUnique({
      where: { slug: 'sys-assistant' }
    });

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

    // Call Mock-service
    // Handle the docker bridged network vs local execution seamlessly
    let endpointUrl = connection.endpointUrl;
    if (endpointUrl.includes('8000/v1') || endpointUrl.includes('localhost')) {
      // process.env.UPLOAD_DIR indicates we are running inside the du-app Docker container
      const isDocker = process.env.UPLOAD_DIR === '/app/uploads';
      const host = isDocker ? 'mock-service' : 'localhost';
      endpointUrl = `http://${host}:3099/ext/sys-assistant`;
    } else {
      // Replace localhost with mock-service hostname if in docker
      if (process.env.UPLOAD_DIR === '/app/uploads') {
        endpointUrl = endpointUrl.replace('localhost', 'mock-service');
      }
    }

    const fetchHeaders: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (connection.authType === 'API_KEY_HEADER' && connection.authKeyHeader) {
      fetchHeaders[connection.authKeyHeader] = connection.authSecret;
    } else if (connection.authType === 'BEARER') {
      fetchHeaders['Authorization'] = `Bearer ${connection.authSecret}`;
    }

    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: fetchHeaders,
      body: JSON.stringify({
        query: prompt
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Chat API] Mock service error:", errText);
      throw new Error(`Failed to fetch from mock-service: ${response.status}`);
    }

    const data = await response.json();
    
    return NextResponse.json({ response: data.response || "No response" });

  } catch (error: any) {
    console.error("[Chat API] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
