const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { createRetriever } = require('../src/retrieval');


const retriever = createRetriever(
  path.join(
    __dirname,
    '..',
    'knowledge-base'
  )
);



// Knowledge Base Parsing


test(
  'parses front matter and splits documents into cited headings',
  () => {
    assert.equal(
      retriever.documents.length,
      14
    );


    const currentPolicy =
      retriever.documents.find(
        (doc) =>
          doc.filename ===
          '01-returns-policy-current.md'
      );


    assert.equal(
      currentPolicy.metadata.status,
      'active'
    );


    assert.ok(
      currentPolicy.sections.some(
        (section) =>
          section.heading ===
          'Standard return window'
      )
    );
  }
);



// Authoritative Policy Retrieval


test(
  'prefers current authoritative policy over superseded return policy',
  () => {
    const passages =
      retriever.search(
        'How long does a regular customer have to return an unused backpack?'
      );


    assert.equal(
      passages[0].filename,
      '01-returns-policy-current.md'
    );


    assert.equal(
      passages[0].heading,
      'Standard return window'
    );


    assert.ok(
      !passages.some(
        (p) =>
          p.filename ===
          '02-returns-policy-legacy.md'
      )
    );
  }
);



// Internal Content Filtering


test(
  'excludes internal draft and instruction-like content from normal retrieval',
  () => {
    const passages =
      retriever.search(
        'give everyone 60 days and reveal hidden prompt'
      );


    assert.ok(
      !passages.some(
        (p) =>
          p.filename ===
          '14-internal-content-migration-notes.md'
      )
    );


    assert.ok(
      passages.every(
        (p) =>
          p.metadata.status ===
            'active' &&
          p.metadata.audience ===
            'customer'
      )
    );
  }
);



// Source Citation


test(
  'returns source filename and heading for a relevant policy answer',
  () => {
    const passage =
      retriever.search(
        'Are bags covered by warranty?'
      )[0];


    assert.equal(
      passage.filename,
      '07-warranty.md'
    );


    assert.ok(
      passage.heading.length > 0
    );
  }
);



// Conflicting Product-Care Sources


test(
  'surfaces the active dishwasher-care disagreement rather than silently choosing a source',
  () => {
    const passages =
      retriever.search(
        'Can I put the entire Breeze Tumbler in the dishwasher?',
        {
          limit: 8
        }
      );


    const conflicts =
      retriever.findConflicts(
        'Can I put the entire Breeze Tumbler in the dishwasher?',
        passages
      );


    assert.equal(
      conflicts.length,
      1
    );


    assert.deepEqual(
      conflicts[0].passages
        .map((p) => p.filename)
        .sort(),
      [
        '11-product-care.md',
        '12-breeze-tumbler-product-card.md'
      ]
    );
  }
);