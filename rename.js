const fs = require('fs/promises');
const path = require('path');

async function renameAndMove() {
  const root = 'd:\\Jobs\\scratch\\dugate';
  
  const moves = [
    ['lib/converters', 'lib/transformers'],
    ['lib/pipelines/convert.ts', 'lib/pipelines/transform.ts'],
    ['app/api/v1/convert', 'app/api/v1/transform'],
    ['app/api/convert', 'app/api/transform'],
    ['app/convert', 'app/transform'],
    ['docs-site/vi/features/pdf-conversion.md', 'docs-site/vi/features/pdf-transformation.md']
  ];

  for (const [src, dest] of moves) {
    const srcPath = path.join(root, src);
    const destPath = path.join(root, dest);
    try {
      await fs.rename(srcPath, destPath);
      console.log(`Renamed: ${src} -> ${dest}`);
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.log(`Skipped (not found): ${src}`);
      } else {
        console.error(`Failed to rename ${src}:`, e);
      }
    }
  }
}

renameAndMove().catch(console.error);
