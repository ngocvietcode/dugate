import { getTableColumns } from 'drizzle-orm';
import { apiKeys, externalApiOverrides, profileEndpoints } from '@/lib/db/schema';
import {
  API_KEY_EXPORT_COLUMNS, API_KEY_NOOP_COLUMNS, API_KEY_SECRET_COLUMNS,
  EXTERNAL_API_OVERRIDE_EXPORT_COLUMNS, EXTERNAL_API_OVERRIDE_NOOP_COLUMNS, EXTERNAL_API_OVERRIDE_SECRET_COLUMNS,
  PROFILE_ENDPOINT_EXPORT_COLUMNS, PROFILE_ENDPOINT_NOOP_COLUMNS, PROFILE_ENDPOINT_SECRET_COLUMNS,
} from '@/lib/profiles/release/fields';

function expectCompleteClassification(
  columns: Record<string, unknown>,
  groups: readonly (readonly string[])[],
): void {
  const classified = groups.flat();
  expect(new Set(classified).size).toBe(classified.length);
  expect(new Set(classified)).toEqual(new Set(Object.keys(columns)));
}

describe('Profile Release schema drift guard', () => {
  it('classifies every ApiKey column as export, secret/internal, or no-op', () => {
    expectCompleteClassification(getTableColumns(apiKeys), [
      API_KEY_EXPORT_COLUMNS, API_KEY_SECRET_COLUMNS, API_KEY_NOOP_COLUMNS,
    ]);
  });

  it('classifies every ProfileEndpoint column as export, secret/internal, or no-op', () => {
    expectCompleteClassification(getTableColumns(profileEndpoints), [
      PROFILE_ENDPOINT_EXPORT_COLUMNS, PROFILE_ENDPOINT_SECRET_COLUMNS, PROFILE_ENDPOINT_NOOP_COLUMNS,
    ]);
  });

  it('classifies every ExternalApiOverride column as export, secret/internal, or no-op', () => {
    expectCompleteClassification(getTableColumns(externalApiOverrides), [
      EXTERNAL_API_OVERRIDE_EXPORT_COLUMNS, EXTERNAL_API_OVERRIDE_SECRET_COLUMNS, EXTERNAL_API_OVERRIDE_NOOP_COLUMNS,
    ]);
  });
});
