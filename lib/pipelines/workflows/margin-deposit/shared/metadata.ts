// lib/pipelines/workflows/margin-deposit/shared/metadata.ts
// Parses and validates the `metadata` field on incoming margin-deposit requests.
// `mode` is required with NO default (unlike the old e2e-defaulting resolver);
// any value outside the 4 supported modes is rejected before any file is touched.

import { MARGIN_MODES, type MarginMode } from './types';

/** Parses `metadata` (object or JSON string) into a plain record, or {} if absent. */
export function parseRawMetadata(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'string') {
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // fall through to the stable error below
    }
    throw new Error('INVALID_INPUT: metadata must be a JSON object.');
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('INVALID_INPUT: metadata must be an object.');
  }
  return raw as Record<string, unknown>;
}

/**
 * Resolves `metadata.mode` to one of the four supported margin-deposit modes.
 * Unlike the old `resolveProcessingMode`, there is NO default: `mode` is
 * required, and `e2e`/`gd1`/`gd2`/any other value throws INVALID_INPUT.
 */
export function resolveMarginMode(rawMetadata: unknown): MarginMode {
  const metadata = parseRawMetadata(rawMetadata);
  const mode = metadata.mode;
  if (typeof mode !== 'string' || !MARGIN_MODES.includes(mode as MarginMode)) {
    throw new Error(
      `INVALID_INPUT: metadata.mode is required and must be one of ${JSON.stringify(MARGIN_MODES)}. Received: ${JSON.stringify(mode)}.`,
    );
  }
  return mode as MarginMode;
}
