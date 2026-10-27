const fs = require('fs');
const path = require('path');

const CORE_DIR = path.join(__dirname, 'core');
const OUTPUT_DIR = path.join(__dirname, 'extracted_roles');

// Create output directory if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      if (file.endsWith('.md') || file.endsWith('.csv')) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

function processSkill(skillDirName) {
  const skillPath = path.join(CORE_DIR, skillDirName);
  
  if (!fs.statSync(skillPath).isDirectory()) return;

  console.log(`Processing role/skill: ${skillDirName}`);
  
  const filesToProcess = getAllFiles(skillPath);
  let combinedContent = `# Role: ${skillDirName}\n\n`;

  // Sort files to put SKILL.md first, then workflow.md, then others
  filesToProcess.sort((a, b) => {
    const aName = path.basename(a).toLowerCase();
    const bName = path.basename(b).toLowerCase();
    if (aName === 'skill.md') return -1;
    if (bName === 'skill.md') return 1;
    if (aName === 'workflow.md') return -1;
    if (bName === 'workflow.md') return 1;
    return a.localeCompare(b);
  });

  filesToProcess.forEach(filePath => {
    const relativePath = path.relative(skillPath, filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    combinedContent += `## File: ${relativePath}\n\n`;
    
    if (filePath.endsWith('.csv')) {
      combinedContent += '```csv\n' + content + '\n```\n\n';
    } else {
      combinedContent += content + '\n\n';
    }
  });

  const outputPath = path.join(OUTPUT_DIR, `${skillDirName}.md`);
  fs.writeFileSync(outputPath, combinedContent);
  console.log(`Saved: ${outputPath}`);
}

const skills = fs.readdirSync(CORE_DIR);
skills.forEach(processSkill);

console.log('Done extracting all roles/skills!');
