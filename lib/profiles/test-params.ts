// lib/profiles/test-params.ts
// Which parameters the Profile "Test Endpoint" flow is allowed to send.
//
// The server treats a locked parameter as admin-owned: `mergeParameters`
// (lib/endpoints/profile-resolver.ts) answers 400 `forbidden-field` as soon as a
// locked key is PRESENT in the request form, regardless of its value.
//
// The Test modal pre-fills its inputs from the saved profile values — locked ones
// included — and used to append every non-empty entry to the FormData. So any
// endpoint with at least one locked parameter could never be tested: every run
// came back "The '<key>' field cannot be set by the client." The cURL preview
// already filtered locked keys out, which is the clearest evidence that sending
// them was never intended.

import { shouldDisplayProfileParameter, type ProfileParameterSchema } from './parameter-visibility';

export interface ParamDraft {
  value: unknown;
  isLocked?: boolean;
}

export interface ParamSchema extends ProfileParameterSchema {
  defaultLocked?: boolean;
}

/**
 * Lock state resolution, mirroring the server exactly:
 * stored profile flag first, then the sub-case schema default, else unlocked.
 */
export function isParamLocked(
  key: string,
  paramsObj: Record<string, ParamDraft> | null | undefined,
  parametersSchema: Record<string, ParamSchema> | null | undefined,
): boolean {
  return paramsObj?.[key]?.isLocked ?? parametersSchema?.[key]?.defaultLocked ?? false;
}

/**
 * The `key=value` pairs a client is actually allowed to submit.
 * Drops locked keys, empty values, internal `_workflow*` maps (prompt/model/
 * reasoning_effort overrides consumed server-side only — never a request
 * field), and any param currently hidden by its `showWhen` gate (e.g. an
 * encryption sub-param while `encryption_enabled` is off).
 */
export function selectSendableTestParams(
  testParams: Record<string, string | undefined | null>,
  paramsObj: Record<string, ParamDraft> | null | undefined,
  parametersSchema: Record<string, ParamSchema> | null | undefined,
): Array<[string, string]> {
  return Object.entries(testParams)
    .filter(([key, value]) =>
      value !== '' && value !== undefined && value !== null
      && !key.startsWith('_workflow')
      && !isParamLocked(key, paramsObj, parametersSchema)
      && shouldDisplayProfileParameter(parametersSchema?.[key], paramsObj ?? {}, key, parametersSchema ?? undefined))
    .map(([key, value]) => [key, String(value)]);
}
