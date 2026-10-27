const fs = require('fs');
const path = require('path');

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      removeEmptyDirs(fullPath);
    }
  }
  // Try to remove current dir if it's empty
  try {
    fs.rmdirSync(dir);
  } catch (err) {}
}

const UPLOAD_DIR = './uploads';
const OUTPUT_DIR = './outputs';

removeEmptyDirs(UPLOAD_DIR);
removeEmptyDirs(OUTPUT_DIR);
console.log('Cleaned up empty directories in current workspace');
