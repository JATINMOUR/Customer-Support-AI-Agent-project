const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ConversationSession,
  SessionStore
} = require('../src/conversation');



// International Shipping Context


test(
  'keeps international-shipping context for a Canada follow-up',
  () => {
    const session =
      new ConversationSession('international');


    session.addUserMessage(
      'Do you ship internationally?'
    );


    session.addAssistantMessage(
      'We ship internationally to supported countries.',
      {
        subjects: ['shipping']
      }
    );


    assert.deepEqual(
      session
        .relevantHistory(
          'What about Canada, and how long does it take?'
        )
        .map((turn) => turn.content),
      [
        'Do you ship internationally?',
        'We ship internationally to supported countries.'
      ]
    );
  }
);



// Order Context


test(
  'keeps an order context for a delivery follow-up',
  () => {
    const session =
      new ConversationSession('order');


    session.addUserMessage(
      'Where is ORD-1007?'
    );


    session.addAssistantMessage(
      'It has shipped.',
      {
        subjects: [
          'ORD-1007',
          'delivery'
        ]
      }
    );


    assert.equal(
      session
        .relevantHistory(
          'When will it arrive?'
        )[0].content,
      'Where is ORD-1007?'
    );
  }
);



// Unrelated Topic History


test(
  'does not attach unrelated topic history',
  () => {
    const session =
      new ConversationSession('unrelated');


    session.addUserMessage(
      'Do you ship internationally?'
    );


    session.addAssistantMessage(
      'Yes.',
      {
        subjects: ['shipping']
      }
    );


    assert.deepEqual(
      session.relevantHistory(
        'What is your return window?'
      ),
      []
    );
  }
);



// Session Isolation & History Limit


test(
  'sessions are isolated and history is bounded',
  () => {
    const store =
      new SessionStore({
        maxTurns: 2
      });


    const first =
      store.get('first');

    const second =
      store.get('second');


    // --------------------------------------------------------
    // Sessions remain isolated
    // --------------------------------------------------------

    first.addUserMessage(
      'Where is ORD-1007?'
    );


    second.addUserMessage(
      'Do you ship internationally?'
    );


    assert.equal(
      second
        .relevantHistory(
          'When will it arrive?'
        )[0].content,
      'Do you ship internationally?'
    );


    // --------------------------------------------------------
    // History is bounded
    // --------------------------------------------------------

    first.addAssistantMessage(
      'It shipped.',
      {
        subjects: ['ORD-1007']
      }
    );


    first.addUserMessage(
      'What is the return window?'
    );


    assert.equal(
      first.turns.length,
      2
    );
  }
);