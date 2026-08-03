import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();

function getAllRepoFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);
  files.forEach((file) => {
    if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'brain' || file === 'lpc_repo' || file === 'Sprites') return;
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllRepoFiles(fullPath, arrayOfFiles);
    } else if (/\.(js|mjs|cjs|html|json|md)$/i.test(file)) {
      arrayOfFiles.push(fullPath);
    }
  });
  return arrayOfFiles;
}

const allRepoFiles = getAllRepoFiles(rootDir);
const fileContents = {};
allRepoFiles.forEach(f => {
  fileContents[f] = fs.readFileSync(f, 'utf8');
});

const srcFiles = allRepoFiles.filter(f => f.replace(/\\/g, '/').includes('/src/') && f.endsWith('.js'));

const detailedAudit = [];

srcFiles.forEach(filePath => {
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const content = fileContents[filePath];

  // Extract all exports
  const exports = [];
  const exportFuncs = [...content.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g)];
  exportFuncs.forEach(m => exports.push({ name: m[1], type: 'function' }));
  const exportVars = [...content.matchAll(/export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)/g)];
  exportVars.forEach(m => exports.push({ name: m[1], type: 'variable' }));
  const namedExports = [...content.matchAll(/export\s+\{([^}]+)\}/g)];
  namedExports.forEach(m => {
    m[1].split(',').forEach(item => {
      const name = item.trim().split(/\s+as\s+/).pop().trim();
      if (name) exports.push({ name, type: 'named' });
    });
  });

  // Check usage of each export across ENTIRE REPO (outside this file)
  exports.forEach(exp => {
    const usages = [];
    const re = new RegExp(`\\b${exp.name}\\b`, 'g');

    for (const [otherFile, otherContent] of Object.entries(fileContents)) {
      if (otherFile === filePath) continue;
      const matches = otherContent.match(re);
      if (matches) {
        const otherRel = path.relative(rootDir, otherFile).replace(/\\/g, '/');
        usages.push({ file: otherRel, count: matches.length });
      }
    }

    const internalMatches = content.match(re);
    const internalCount = internalMatches ? internalMatches.length : 0;

    detailedAudit.push({
      file: relPath,
      symbol: exp.name,
      symbolType: exp.type,
      externalUsages: usages,
      externalCount: usages.reduce((a, b) => a + b.count, 0),
      internalCount
    });
  });
});

let out = '';
const zeroUsage = detailedAudit.filter(d => d.externalCount === 0);
out += `Audited ${detailedAudit.length} exported symbols across ${srcFiles.length} files.\n`;
out += `EXPORTS WITH 0 EXTERNAL USAGE ACROSS ALL REPO FILES (INC. TESTS, SIMS, HTML, TOOLS): ${zeroUsage.length}\n`;

const grouped = {};
zeroUsage.forEach(u => {
  if (!grouped[u.file]) grouped[u.file] = [];
  grouped[u.file].push({ symbol: u.symbol, type: u.symbolType, internalCount: u.internalCount });
});

for (const [file, items] of Object.entries(grouped)) {
  out += `\n${file}:\n`;
  items.forEach(it => {
    out += `  - ${it.symbol} (${it.type}) [Internal occurrences in file: ${it.internalCount}]\n`;
  });
}

fs.writeFileSync(path.join(rootDir, 'scratch/audit_summary.txt'), out);
console.log('Done writing audit_summary.txt');
