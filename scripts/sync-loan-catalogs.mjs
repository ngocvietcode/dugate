#!/usr/bin/env node
// Đồng bộ catalog spec-v3 vào code (T-CAT-01, F-R01): code không import trực tiếp từ docs/.
//   docs/loan-appraisal/spec-v3/03_catalogs/*.json            → lib/loan-dossier/catalog/data/*.json
//   docs/loan-appraisal/spec-v3/03_catalogs/doc_schemas/*.json → lib/loan-dossier/catalog/data/doc_schemas/*.json
// File thừa trong data/ bị xóa. Chạy lại cho cùng kết quả (idempotent).
// Dùng: npm run sync:loan-catalogs
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = join(ROOT, 'docs', 'loan-appraisal', 'spec-v3', '03_catalogs');
export const DEST = join(ROOT, 'lib', 'loan-dossier', 'catalog', 'data');

/** Danh sách file JSON (đường dẫn tương đối, dấu `/`) trong một thư mục, 1 cấp con. */
export function listJson(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      for (const sub of readdirSync(full).sort()) {
        if (sub.endsWith('.json')) out.push(`${name}/${sub}`);
      }
    } else if (name.endsWith('.json')) {
      out.push(name);
    }
  }
  return out;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function sync() {
  const wanted = listJson(SRC);
  if (wanted.length === 0) throw new Error(`Không tìm thấy catalog ở ${relative(ROOT, SRC)}`);
  let copied = 0;
  for (const rel of wanted) {
    const from = join(SRC, rel);
    const to = join(DEST, rel);
    mkdirSync(dirname(to), { recursive: true });
    if (!existsSync(to) || sha256(from) !== sha256(to)) {
      copyFileSync(from, to);
      copied += 1;
    }
  }
  const keep = new Set(wanted);
  let removed = 0;
  for (const rel of listJson(DEST)) {
    if (!keep.has(rel)) {
      rmSync(join(DEST, rel));
      removed += 1;
    }
  }
  return { total: wanted.length, copied, removed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = sync();
  console.log(`sync-loan-catalogs: ${r.total} file, chép ${r.copied}, xóa ${r.removed}`);
}
