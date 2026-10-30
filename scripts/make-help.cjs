const fs = require('node:fs');
const path = require('node:path');
console.log('\nHarbor Terminal — development and packaging\n\nUsage: make <command> [ARCH=native|arm64|x64] [OUT=release]\n');
for (const line of fs.readFileSync(path.join(__dirname, '../Makefile'), 'utf8').split('\n')) {
  const match = line.match(/^([\w-]+):.*?## (.+)$/);
  if (match) console.log(`  ${match[1].padEnd(18)} ${match[2]}`);
}
console.log('\nExamples:\n  make install\n  make dev\n  make pack-mac ARCH=arm64\n  make pack-win ARCH=x64\n  make pack OUT=release/preview\n\nPackaging requires the target OS and its native build tools.\n');
