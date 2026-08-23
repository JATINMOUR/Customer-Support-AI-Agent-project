const assert = require('node:assert/strict');
const test = require('node:test');

const { SupportAgent } = require('../src/agent');
const { redact } = require('../src/traceLogger');



// Debug Trace Logging


test(
  'debug trace records the decision path and sanitized tool result',
  () => {
    const entries = [];


    const agent = new SupportAgent({
      debug: true,
      traceWriter: (entry) =>
        entries.push(entry)
    });


    agent.respond({
      sessionId: 'trace-test',
      message:
        'Where is ORD-1007 and when will it arrive?'
    });


    
    // Trace Entry
    

    assert.equal(
      entries.length,
      1
    );


    assert.equal(
      entries[0].event,
      'support_agent_response'
    );


    
    // Tool Call
    

    assert.equal(
      entries[0].tool_call.name,
      'order_lookup'
    );


    assert.equal(
      entries[0].tool_call.result.carrier,
      'UPS'
    );


    
    // Sensitive Data Protection
    

    assert.doesNotMatch(
      JSON.stringify(entries[0]),
      /ava\.morgan|King Street|risk_score|fraud/i
    );
  }
);



// Nested Trace Redaction


test(
  'trace redaction removes nested customer and internal fields',
  () => {
    const sanitized = redact({
      customer: {
        email:
          'private@example.test'
      },

      internal: {
        risk_score: 82
      },

      ok: true
    });


    assert.deepEqual(
      sanitized,
      {
        ok: true
      }
    );
  }
);