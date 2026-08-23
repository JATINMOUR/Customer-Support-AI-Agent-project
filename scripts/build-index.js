// 1. Import dependencies
const fs = require('node:fs');
const path = require('node:path');

// 2. Import retrieval functions
const {
  loadKnowledgeBase,
  toPublicPassage
} = require('../src/retrieval');

// 3. Define project root
const root = path.resolve(__dirname, '..');

// 4. Load knowledge base
const index = loadKnowledgeBase(
  path.join(root, 'knowledge-base')
);

// 5. Convert chunks into public passages
const publicIndex = index.chunks.map(toPublicPassage);

// 6. Create generated directory
const generatedDir = path.join(root, 'generated');

fs.mkdirSync(generatedDir, {
  recursive: true
});

// 7. Generate JSON index
const outputFile = path.join(
  generatedDir,
  'knowledge-index.json'
);

fs.writeFileSync(
  outputFile,
  JSON.stringify(publicIndex, null, 2) + '\n'
);

// 8. Display result
console.log(
  `Indexed ${publicIndex.length} passages from ${index.documents.length} documents.`
);