/**
 * Complete schema classification for Profile Release. New columns must be
 * deliberately assigned to one list; the schema-drift test enforces this.
 */
export const API_KEY_EXPORT_COLUMNS = [
  'name', 'displayName', 'role', 'note', 'workerGroup', 'rateLimitPerMin',
  'spendingLimit', 'status', 'fileAuthConfig', 'callbackAuthConfig', 'callbackPayload',
] as const;
export const API_KEY_SECRET_COLUMNS = ['id', 'keyHash', 'prefix', 'totalUsed', 'createdAt', 'updatedAt'] as const;
export const API_KEY_NOOP_COLUMNS = ['callbackUrl', 'callbackUrlLocked'] as const;

export const PROFILE_ENDPOINT_EXPORT_COLUMNS = [
  'endpointSlug', 'enabled', 'parameters', 'connectionsOverride', 'jobPriority',
  'fileUrlDefaultChunks', 'allowedFileExtensions', 'referenceExtract',
] as const;
export const PROFILE_ENDPOINT_SECRET_COLUMNS = ['id', 'apiKeyId', 'createdAt', 'updatedAt'] as const;
// `fileUrlAuthConfig` is retired: the per-endpoint file-download credential override was
// removed (it leaked plaintext credentials to the browser and could not be edited without
// re-entering the secret). File-download auth now lives only on ApiKey.fileAuthConfig.
// The column stays in the database until a later release drops it, and the bundle keeps
// emitting `fileUrlAuth: null` so previously exported bundles still validate.
export const PROFILE_ENDPOINT_NOOP_COLUMNS = [
  'fileUrlEnabled', 'callbackEnabled', 'callbackUrlOverride', 'callbackPayloadOverride',
  'fileUrlAuthConfig',
] as const;

export const EXTERNAL_API_OVERRIDE_EXPORT_COLUMNS = [
  'connectionId', 'apiKeyId', 'endpointSlug', 'stepId', 'promptOverride',
  'modelOverride', 'reasoningEffortOverride',
] as const;
export const EXTERNAL_API_OVERRIDE_SECRET_COLUMNS = ['id', 'createdAt', 'updatedAt'] as const;
export const EXTERNAL_API_OVERRIDE_NOOP_COLUMNS: readonly string[] = [];
