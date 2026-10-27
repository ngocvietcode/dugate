// lib/audit/policy.ts
// Field-level disclosure policy for ConfigAudit.changes. The audit log is an
// accountability record, not a configuration backup: only safe short values
// may be shown; credentials and lengthy content are represented safely.

export type AuditFieldMode = 'VALUE' | 'PRESENCE' | 'SUMMARY' | 'OMIT';
export type AuditFieldPolicy = Readonly<Record<string, AuditFieldMode>>;

const value = (fields: readonly string[]): AuditFieldPolicy => Object.fromEntries(fields.map((field) => [field, 'VALUE']));
const presence = (fields: readonly string[]): AuditFieldPolicy => Object.fromEntries(fields.map((field) => [field, 'PRESENCE']));
const summary = (fields: readonly string[]): AuditFieldPolicy => Object.fromEntries(fields.map((field) => [field, 'SUMMARY']));

export const AUDIT_POLICIES = {
  PROFILE: {
    ...value(['name', 'displayName', 'status', 'rateLimitPerMin', 'callbackPayload']),
    ...summary(['note']),
    ...presence(['keyHash', 'fileAuthConfig', 'callbackAuthConfig']),
  },
  CONNECTOR: {
    ...value(['name', 'slug', 'httpMethod', 'authType', 'authKeyHeader', 'promptFieldName', 'fileFieldName', 'responseContentPath', 'sessionIdResponsePath', 'sessionIdFieldName', 'timeoutSec', 'state']),
    // URLs can carry credentials in query strings; log only a summary like prompts.
    ...summary(['description', 'endpointUrl', 'defaultPrompt', 'staticFormFields']),
    // Both values and names in extra headers may be sensitive. Vault paths are
    // security-relevant references, so reveal only whether the reference changed.
    ...presence(['authSecret', 'vaultSecretPath', 'extraHeaders']),
  },
  OVERRIDE: {
    ...value(['modelOverride', 'reasoningEffortOverride']),
    ...summary(['promptOverride']),
  },
  ENDPOINT: {
    ...value(['enabled', 'jobPriority', 'allowedFileExtensions', 'fileUrlDefaultChunks', 'connectionsOverride']),
    ...summary(['referenceExtract']),
    ...presence(['parameters']),
  },
  // Identities hold no credential: authentication is delegated to the external
  // IDP, so there is no auth field to redact here.
  USER: value(['username', 'email', 'role']),
  ASSIGNMENT: value(['apiKeyIds']),
} as const satisfies Record<string, AuditFieldPolicy>;

export type AuditedEntityType = keyof typeof AUDIT_POLICIES;

export function policyFor(entityType: AuditedEntityType): AuditFieldPolicy {
  return AUDIT_POLICIES[entityType];
}
