// lib/pipelines/workflows/payment-account-management/shared/metadata.ts
// Parse + validate the `metadata` field on incoming workflow requests.
// `mode` is validated + required; `stage` and `data` are flattened onto the result
// for direct runner access. Any OTHER caller-supplied keys are forwarded via `extra`.

import { PAM_MODES, type PamMetadata, type PamMode } from './types';

/**
 * Parse the raw `metadata` value coming from pipelineVars into a validated PamMetadata.
 *
 * Accepts:
 *   - object (already parsed by the workflows route)
 *   - JSON string (fallback)
 *   - null / undefined → throws INVALID_METADATA (mode is required)
 *
 * Throws INVALID_METADATA (Vietnamese message) so failWorkflow surfaces it to the client.
 */
export function parseMetadata(raw: unknown): PamMetadata {
  if (raw == null) {
    throw new Error(
      `INVALID_METADATA: Trường "metadata" là bắt buộc. Vui lòng gửi JSON có field "mode" ∈ ${JSON.stringify(PAM_MODES)}.`,
    );
  }

  let obj: Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error('INVALID_METADATA: "metadata" không phải JSON hợp lệ.');
    }
  } else if (typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  } else {
    throw new Error(`INVALID_METADATA: "metadata" phải là object hoặc JSON string, nhận được ${typeof raw}.`);
  }

  const mode = obj.mode;
  if (typeof mode !== 'string' || !PAM_MODES.includes(mode as PamMode)) {
    throw new Error(
      `INVALID_METADATA: "metadata.mode" bắt buộc và phải ∈ ${JSON.stringify(PAM_MODES)}. Nhận được: ${JSON.stringify(mode)}.`,
    );
  }

  // Flatten known fields. `stage` (string) and `data` (object) are read directly by runners.
  const { mode: _m, stage: rawStage, data: rawData, ...rest } = obj;

  if (rawStage !== undefined && typeof rawStage !== 'string') {
    throw new Error(`INVALID_METADATA: "metadata.stage" phải là string. Nhận được: ${typeof rawStage}.`);
  }
  if (rawData !== undefined && (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData))) {
    throw new Error(`INVALID_METADATA: "metadata.data" phải là object. Nhận được: ${typeof rawData}.`);
  }

  // Preserve any remaining unknown caller-supplied fields for forward-compat.
  const extra = Object.keys(rest).length > 0 ? rest : null;

  return {
    mode: mode as PamMode,
    stage: rawStage as string | undefined,
    data: rawData as Record<string, unknown> | undefined,
    extra,
  };
}
