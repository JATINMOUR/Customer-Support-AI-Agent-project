const assert = require('node:assert/strict');
const test = require('node:test');

const { renderResponse } = require('../src/cli');



// CLI Response Formatting Test


test(
  'CLI response formatting exposes answer, sources, and handoff state',
  () => {
    const rendered = renderResponse({
      answer:
        'The supplied information is insufficient.',

      sources: [
        '01-returns-policy-current.md — Standard return window'
      ],

      handoff: true
    });


    // --------------------------------------------------------
    // Answer
    // --------------------------------------------------------

    assert.match(
      rendered,
      /The supplied information is insufficient/
    );


    // --------------------------------------------------------
    // Sources
    // --------------------------------------------------------

    assert.match(
      rendered,
      /Sources:/
    );


    assert.match(
      rendered,
      /01-returns-policy-current.md/
    );


    // --------------------------------------------------------
    // Human Handoff
    // --------------------------------------------------------

    assert.match(
      rendered,
      /Human handoff recommended/
    );
  }
);