// app/api/margin-eval/render/route.ts
// Server-side PDF page → PNG renderer for the Margin Deposit Eval UI preview.
// The browser build of pdfjs-dist 5.x is unreliable across environments
// ("Object.defineProperty called on non-object"), so preview rendering is done
// on the server with the same pdf-parse screenshot path the workflow already uses.
//
// POST multipart form-data:
//   file  : the PDF (required)
//   page  : 1-based page number (default 1)
// Returns: image/png of that page, or a JSON error.

import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { renderPageImages } from '@/lib/pipelines/workflows/financial-report/pdf-utils';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ── Rendered-page cache ──────────────────────────────────────────────────────
// Rendering the same page repeatedly (prev/next/jump on the same file) is the
// common case in the eval UI. Cache the rendered PNG by content hash + page so
// repeat navigation is served from memory instead of re-parsing/re-rendering
// the whole PDF. Bounded LRU keeps memory in check for large sessions.
const RENDER_SCALE = 2.0;
const MAX_CACHE_ENTRIES = 60;
interface CacheEntry { png: Buffer; totalPages: number }
const pageCache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | undefined {
  const hit = pageCache.get(key);
  if (hit) { pageCache.delete(key); pageCache.set(key, hit); } // LRU bump
  return hit;
}

function cacheSet(key: string, entry: CacheEntry): void {
  pageCache.set(key, entry);
  while (pageCache.size > MAX_CACHE_ENTRIES) {
    const oldest = pageCache.keys().next().value;
    if (oldest === undefined) break;
    pageCache.delete(oldest);
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const pageRaw = (form.get('page') as string | null) ?? '1';
    const page = Math.max(1, parseInt(pageRaw, 10) || 1);

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Thiếu file PDF.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentHash = createHash('sha1').update(buffer).digest('hex');
    const cacheKey = `${contentHash}:${page}:${RENDER_SCALE}`;

    // Fast path: identical file + page rendered before → serve from cache.
    const cached = cacheGet(cacheKey);
    if (cached) {
      return new NextResponse(new Uint8Array(cached.png), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
          'X-Total-Pages': String(cached.totalPages),
          'X-Rendered-Page': String(cached.totalPages > 0 ? Math.min(page, cached.totalPages) : page),
          'X-Cache': 'HIT',
        },
      });
    }

    // Total page count so the UI can offer free page navigation (prev/next/jump)
    // without needing a field selection. Best-effort — 0 means "unknown".
    let totalPages = 0;
    try {
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      totalPages = doc.getPageCount();
    } catch { totalPages = 0; }

    const safePage = totalPages > 0 ? Math.min(page, totalPages) : page;
    const rendered = await renderPageImages(buffer, safePage, safePage, file.name || 'preview.pdf', RENDER_SCALE);
    const png = rendered[0]?.buffer;
    if (!png) {
      return NextResponse.json({ error: `Không render được trang ${safePage}.` }, { status: 422 });
    }

    // Cache under the requested page and the clamped page so a later request for
    // either resolves to the same PNG without re-rendering.
    cacheSet(cacheKey, { png, totalPages });
    if (safePage !== page) cacheSet(`${contentHash}:${safePage}:${RENDER_SCALE}`, { png, totalPages });

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-Total-Pages': String(totalPages),
        'X-Rendered-Page': String(safePage),
        'X-Cache': 'MISS',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Render lỗi: ${message}` }, { status: 500 });
  }
}
