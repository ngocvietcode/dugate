import { E2E_API_KEY } from './setup';

// Defaults to the dev server port 2023
export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:2023/api/v1';

/**
 * Creates a simple mock file Blob for testing uploads
 */
export function createDummyPdfBlob(): Blob {
  // A minimal valid PDF header/EOF
  const pdfBytes = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A, 
    // Content doesn't matter for the mock service as long as routing understands it's a file
    0x0A, 0x25, 0x25, 0x45, 0x4F, 0x46
  ]);
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

export function createDummyDocxBlob(): Blob {
  // A completely fake docx file (just a zip file signature)
  const docxBytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04]); 
  return new Blob([docxBytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export async function submitRequest(endpoint: string, formData: FormData) {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': E2E_API_KEY,
    },
    body: formData, // the browser/node native FormData handles boundary automatically
  });
  if (response.status === 400 || response.status === 500) {
    const text = await response.clone().text();
    console.error(`Status ${response.status} from ${endpoint}. Response:`, text);
  }
  return response;
}

export async function pollOperation(operationId: string, timeoutMs = 15000): Promise<any> {
  const url = `${API_BASE_URL}/operations/${operationId}`;
  const pollInterval = 500;
  const maxRetries = Math.ceil(timeoutMs / pollInterval);
  
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': E2E_API_KEY,
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Polling failed with status ${res.status}. Body: ${errText}`);
    }

    const data = await res.json();
    if (data.done) {
      if (data.state === 'FAILED') {
        throw new Error(`Operation failed: ${data.errorMessage}`);
      }
      return data;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Timeout waiting for operation ${operationId} after ${timeoutMs}ms`);
}
