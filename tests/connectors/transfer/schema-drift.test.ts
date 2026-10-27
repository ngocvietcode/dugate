import { getTableColumns } from 'drizzle-orm';
import { externalApiConnections } from '@/lib/db/schema';
import {
  CONNECTION_EXPORT_COLUMNS,
  CONNECTION_ENV_COLUMNS,
  CONNECTION_SECRET_COLUMNS,
  CONNECTION_INTERNAL_COLUMNS,
} from '@/lib/connectors/transfer/fields';

describe('Connector transfer schema drift guard', () => {
  it('classifies every ExternalApiConnection column exactly once', () => {
    const classified = [
      ...CONNECTION_EXPORT_COLUMNS,
      ...CONNECTION_ENV_COLUMNS,
      ...CONNECTION_SECRET_COLUMNS,
      ...CONNECTION_INTERNAL_COLUMNS,
    ];
    // No column appears in two lists.
    expect(new Set(classified).size).toBe(classified.length);
    // Every DB column is classified, and nothing extra is classified.
    expect(new Set(classified)).toEqual(new Set(Object.keys(getTableColumns(externalApiConnections))));
  });
});
