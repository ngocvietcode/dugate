jest.mock('@/lib/db', () => ({ db: { update: jest.fn() } }));
jest.mock('@/lib/db/schema', () => ({ fileCaches: { id: 'id', refCount: 'refCount' } }));
jest.mock('drizzle-orm', () => ({
  eq: jest.fn(() => 'where-clause'),
  sql: jest.fn(() => 'decrement-expression'),
}));

import { db } from '@/lib/db';
import { releaseDownloadedFileReferences } from '@/lib/file-url-downloader';

const mockedUpdate = db.update as jest.MockedFunction<typeof db.update>;

describe('framework FileCache lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  it('decrements one cache reference for every downloaded framework file', async () => {
    const where = jest.fn(async () => undefined);
    const set = jest.fn(() => ({ where }));
    mockedUpdate.mockReturnValue({ set } as unknown as ReturnType<typeof db.update>);

    await releaseDownloadedFileReferences([
      { name: 'a.pdf', path: 'cache/a.pdf', mime: 'application/pdf', size: 1, fileCacheId: 'cache-a' },
      { name: 'b.pdf', path: 'cache/b.pdf', mime: 'application/pdf', size: 1, fileCacheId: 'cache-b' },
    ]);

    expect(mockedUpdate).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(2);
  });
});