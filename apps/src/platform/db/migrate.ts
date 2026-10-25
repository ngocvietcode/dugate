import { connectPg, migrate } from './index';

async function main() {
  const url = process.env.APPS_DATABASE_URL;
  if (!url) throw new Error('thiếu APPS_DATABASE_URL');
  const applied = await migrate(await connectPg(url));
  console.log(applied.length ? `đã áp dụng: ${applied.join(', ')}` : 'không có migration mới');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
