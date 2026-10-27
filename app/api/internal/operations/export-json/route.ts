// app/api/internal/operations/export-json/route.ts
// POST /api/internal/operations/export-json — REMOVED.
//
// The JSON export shipped full customer results (output content + extracted data)
// out of DUGate and was unused. Request content is no longer kept long-term
// (lib/operations/content-retention.ts), so the route answers 410 Gone.
// CSV export (metadata only) remains at /api/internal/operations/export-csv.

import { NextResponse, type NextRequest } from 'next/server';

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'JSON export has been removed. Use the CSV export for operational metadata.' },
    { status: 410 },
  );
}
