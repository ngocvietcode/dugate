// app/api/internal/operations/export-html/route.ts
// POST /api/internal/operations/export-html — REMOVED.
//
// The HTML report rendered full customer results out of DUGate and was unused.
// Request content is no longer kept long-term (lib/operations/content-retention.ts),
// so the route answers 410 Gone. CSV export (metadata only) remains at
// /api/internal/operations/export-csv.

import { NextResponse, type NextRequest } from 'next/server';

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'HTML export has been removed. Use the CSV export for operational metadata.' },
    { status: 410 },
  );
}
