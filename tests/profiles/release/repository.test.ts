import { apiKeys } from '@/lib/db/schema';
import { createDrizzleAdapter } from '@/lib/profiles/release/repository';

describe('createDrizzleAdapter', () => {
  it('maps ApiKey updates to the bound Drizzle apiKeys row', async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const tx = { update } as any;
    const payload = { displayName: 'Imported OCR profile', status: 'active' };

    const adapter = createDrizzleAdapter(tx, 'profile-1', 'ocr-profile');
    await adapter.update('ApiKey', payload);

    expect(update).toHaveBeenCalledWith(apiKeys);
    expect(set).toHaveBeenCalledWith(payload);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('deletes persisted overrides whose portable connector/step keys are absent from the bundle', async () => {
    const overrideWhere = jest.fn().mockResolvedValue([
      { id: 'override-a', connectionId: 'connection-a', stepId: '_default' },
      { id: 'override-b', connectionId: 'connection-b', stepId: 'step-1' },
    ]);
    const connectionLimit = jest.fn()
      .mockResolvedValueOnce([{ slug: 'connector-a' }])
      .mockResolvedValueOnce([{ slug: 'connector-b' }]);
    const connectionWhere = jest.fn(() => ({ limit: connectionLimit }));
    const select = jest.fn((fields: Record<string, unknown>) => ({
      from: jest.fn(() => ({
        where: Object.prototype.hasOwnProperty.call(fields, 'connectionId') ? overrideWhere : connectionWhere,
      })),
    }));
    const deleteWhere = jest.fn().mockResolvedValue(undefined);
    const deleteRow = jest.fn(() => ({ where: deleteWhere }));
    const tx = { select, delete: deleteRow } as any;
    const adapter = createDrizzleAdapter(tx, 'profile-1', 'ocr-profile');

    await adapter.deleteOverridesNotIn?.('extract:invoice', ['connector-a\0_default']);

    expect(deleteRow).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });
});
