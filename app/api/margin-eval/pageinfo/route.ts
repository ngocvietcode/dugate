// app/api/margin-eval/pageinfo/route.ts
// Lightweight PDF page-count endpoint for the Margin Deposit Eval UI.
// Used to record page_count per file into the exported session (for the report),
// without rendering any image. Auth is enforced by middleware (session cookie).

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Thiếu file PDF.' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    let pages = 0;
    try {
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      pages = doc.getPageCount();
    } catch { pages = 0; }
    return NextResponse.json({ pages, size: buffer.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
