import { parseFileMetaArray } from '@/lib/pipelines/workflows/margin-deposit/shared/file-meta';

type FileData = { name: string; path: string; mime: string; size: number; file_id?: string };

function file(name: string): FileData {
  return { name, path: `s3/${name}`, mime: 'application/pdf', size: 1024 };
}

describe('parseFileMetaArray — template cap per doc_type', () => {
  it('allows up to 2 don_tra_soat templates', () => {
    const files = [file('a.pdf'), file('b.pdf')];
    const meta = [
      { doc_type: 'don_tra_soat', role: 'template' },
      { doc_type: 'don_tra_soat', role: 'template' },
    ];
    const groups = parseFileMetaArray(files, meta, { maxTemplatesPerDocType: { don_tra_soat: 2 } });
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.meta.role === 'template')).toBe(true);
  });

  it('rejects a 3rd don_tra_soat template', () => {
    const files = [file('a.pdf'), file('b.pdf'), file('c.pdf')];
    const meta = [
      { doc_type: 'don_tra_soat', role: 'template' },
      { doc_type: 'don_tra_soat', role: 'template' },
      { doc_type: 'don_tra_soat', role: 'template' },
    ];
    expect(() => parseFileMetaArray(files, meta, { maxTemplatesPerDocType: { don_tra_soat: 2 } }))
      .toThrow('too many template files for doc_type="don_tra_soat"');
  });

  it('counts only template role — customer don_tra_soat files are unrestricted', () => {
    const files = [file('a.pdf'), file('b.pdf'), file('c.pdf'), file('d.pdf')];
    const meta = [
      { doc_type: 'don_tra_soat', role: 'template' },
      { doc_type: 'don_tra_soat', role: 'template' },
      { doc_type: 'don_tra_soat', role: 'customer' },
      { doc_type: 'don_tra_soat', role: 'customer' },
    ];
    const groups = parseFileMetaArray(files, meta, { maxTemplatesPerDocType: { don_tra_soat: 2 } });
    expect(groups).toHaveLength(4);
  });

  it('does not restrict templates of other doc types', () => {
    const files = [file('a.pdf'), file('b.pdf'), file('c.pdf')];
    const meta = [
      { doc_type: 'thoa_thuan_ky_quy', role: 'template' },
      { doc_type: 'thoa_thuan_ky_quy', role: 'template' },
      { doc_type: 'thoa_thuan_ky_quy', role: 'template' },
    ];
    const groups = parseFileMetaArray(files, meta, { maxTemplatesPerDocType: { don_tra_soat: 2 } });
    expect(groups).toHaveLength(3);
  });

  it('is a no-op when maxTemplatesPerDocType is not provided', () => {
    const files = [file('a.pdf'), file('b.pdf'), file('c.pdf')];
    const meta = [
      { doc_type: 'don_tra_soat', role: 'template' },
      { doc_type: 'don_tra_soat', role: 'template' },
      { doc_type: 'don_tra_soat', role: 'template' },
    ];
    expect(parseFileMetaArray(files, meta)).toHaveLength(3);
  });
});
