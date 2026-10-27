// app/api/internal/vault/test-resolve/route.ts
// POST — Test that a Vault Secret Path resolves, WITHOUT ever returning the value.
// Used by the connector form's "Test resolve" button. Works for unsaved connectors.
// Body: { ref: string }  → { ok: boolean, error?: string }

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guard';
import { getSecretProvider } from '@/lib/secrets';

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;

  try {
    const { ref } = await req.json();
    if (!ref || typeof ref !== 'string' || !ref.trim()) {
      return NextResponse.json({ ok: false, error: 'Vault Secret Path trống' }, { status: 400 });
    }

    const result = await getSecretProvider().testResolve(ref.trim());
    // Never leak the value — only pass/fail (+ error message on failure).
    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
