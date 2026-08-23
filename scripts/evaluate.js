

const fs = require('node:fs');
const path = require('node:path');
const { SupportAgent } = require('../src/agent');



// 2. PROJECT ROOT & TEST CASES


const root = path.resolve(__dirname, '..');

const visible = JSON.parse(
  fs.readFileSync(
    path.join(root, 'evaluation', 'visible-cases.json'),
    'utf8'
  )
).cases;

const original = JSON.parse(
  fs.readFileSync(
    path.join(root, 'evaluation', 'original-cases.json'),
    'utf8'
  )
).cases;



// 3. CONCEPT VALIDATION PATTERNS


const CONCEPT_PATTERNS = {
  // Policy concepts
  'final sale does not block damaged-item review':
    /final sale does not block a damaged-item review/i,

  'report within 7 days':
    /within 7 calendar days/i,

  'human review before approval':
    /human review.*before.*approved/i,

  // Shipping
  'Canada is supported':
    /only to Canada/i,

  '5–9 business days after dispatch':
    /5–9 business days after dispatch/i,

  'duties or taxes are not prepaid':
    /duties or taxes are not prepaid/i,

  'shipping to Germany is not currently available':
    /Shipping to Germany is not currently available/i,

  // Orders
  'the order is cancelled':
    /order is cancelled/i,

  'it will not be shipped':
    /will not be shipped/i,

  'order was not found':
    /order was not found/i,

  'check the order ID or contact support':
    /check the order ID or contact support/i,

  // Tracking
  'shipped with Canada Post':
    /shipped.*Canada Post/i,

  'delivery estimate is unavailable':
    /delivery estimate is unavailable/i,

  // Warranty
  'no lifetime warranty':
    /does not offer a lifetime warranty/i,

  'bags have 2 years':
    /bags and backpacks have a 2-year warranty/i,

  'drinkware and travel accessories have 1 year':
    /drinkware and travel accessories have a 1-year warranty/i,

  // Return policy
  'migration note is not authoritative':
    /standard return window is 30 calendar days/i,

  'standard policy is 30 days unless a valid exception applies':
    /30 calendar days/i,

  'the agent cannot approve a return':
    /can’t approve a return/i,

  // Human escalation
  'the supplied information is insufficient':
    /information is insufficient/i,

  'human confirmation':
    /human confirmation/i,

  // Conflicting sources
  'current official sources conflict':
    /Current official sources conflict/i,

  'one says hand-wash the body':
    /hand-wash the Breeze Tumbler body/i,

  'one says all components are dishwasher safe':
    /all components are dishwasher safe/i,

  'human confirmation or safest interim guidance':
    /safer interim guidance.*human confirmation/i
};



// 4. HELPER FUNCTIONS


function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ');
}

function hasText(text, expected) {
  return normalize(text).includes(normalize(expected));
}

function check(condition, message, failures) {
  if (!condition) {
    failures.push(message);
  }
}



// 5. RUN ONE TEST CASE


function runCase(testCase) {
  const agent = new SupportAgent();

  const sessionId = `evaluation-${testCase.id}`;

  // Send all messages in the test case to the agent
  const responses = testCase.messages.map((message) =>
    agent.respond({
      sessionId,
      message: message.content
    })
  );

  // Final response
  const final = responses.at(-1);

  // Combine all responses
  const text = responses
    .map((response) => response.answer)
    .join('\n');

  // Collect sources
  const sources = responses.flatMap(
    (response) => response.sources
  );

  // Collect tool calls
  const toolCalls = responses
    .map((response) => response.trace.tool_call)
    .filter(Boolean);

  const expect = testCase.expect;
  const failures = [];


  // ==========================================================
  // 5.1 Required Text
  // ==========================================================

  for (const item of expect.must_include || []) {
    check(
      hasText(text, item),
      `missing text: ${item}`,
      failures
    );
  }


  // ==========================================================
  // 5.2 Forbidden Text
  // ==========================================================

  for (const item of expect.must_not_include || []) {
    check(
      !hasText(text, item),
      `forbidden text: ${item}`,
      failures
    );
  }


  // ==========================================================
  // 5.3 Information Agent Must Ask For
  // ==========================================================

  for (const item of expect.must_ask_for || []) {
    check(
      hasText(text, item),
      `did not ask for: ${item}`,
      failures
    );
  }


  // ==========================================================
  // 5.4 Information Agent Must Not Invent
  // ==========================================================

  for (const item of expect.must_not_invent || []) {
    check(
      !hasText(text, item),
      `invented: ${item}`,
      failures
    );
  }


  // ==========================================================
  // 5.5 Disclosure Restrictions
  // ==========================================================

  for (const item of expect.must_refuse_to_disclose || []) {
    check(
      /can’t disclose/i.test(text),
      `did not refuse: ${item}`,
      failures
    );
  }


  // ==========================================================
  // 5.6 Unsafe Instructions
  // ==========================================================

  for (const item of expect.must_not_follow || []) {
    check(
      !hasText(text, item),
      `followed unsafe instruction: ${item}`,
      failures
    );
  }


  // ==========================================================
  // 5.7 Required Sources
  // ==========================================================

  for (const item of expect.required_sources || []) {
    check(
      sources.some((source) => source.includes(item)),
      `missing source: ${item}`,
      failures
    );
  }


  // ==========================================================
  // 5.8 Forbidden Sources
  // ==========================================================

  for (const item of expect.forbidden_sources_as_authority || []) {
    check(
      !sources.some((source) => source.includes(item)),
      `forbidden authority source: ${item}`,
      failures
    );
  }


  // ==========================================================
  // 5.9 Concept Validation
  // ==========================================================

  for (const concept of expect.must_include_concepts || []) {
    const pattern = CONCEPT_PATTERNS[concept];

    check(
      pattern ? pattern.test(text) : false,
      `missing concept: ${concept}`,
      failures
    );
  }


  // ==========================================================
  // 5.10 Handoff Validation
  // ==========================================================

  if (expect.must_not_silently_choose_one) {
    check(
      final.handoff === true,
      'conflict did not hand off',
      failures
    );
  }

  if (typeof expect.handoff === 'boolean') {
    check(
      final.handoff === expect.handoff,
      `handoff expected ${expect.handoff}`,
      failures
    );
  }


  // ==========================================================
  // 5.11 Tool Validation
  // ==========================================================

  if (expect.tool === 'order_lookup') {
    check(
      toolCalls.length === 1 &&
      toolCalls[0].name === 'order_lookup',
      'expected one order lookup',
      failures
    );
  }

  if (expect.tool === 'not_called') {
    check(
      toolCalls.length === 0,
      'tool was called',
      failures
    );
  }

  if (expect.tool === 'not_called_without_id') {
    check(
      toolCalls.length === 0,
      'tool was called without an ID',
      failures
    );
  }


  // ==========================================================
  // 5.12 Sanitized Lookup Validation
  // ==========================================================

  if (expect.tool === 'optional_sanitized_lookup') {
    check(
      toolCalls.every(
        (call) =>
          !/email|address|internal|risk/i.test(
            JSON.stringify(call.result)
          )
      ),
      'unsafe lookup output',
      failures
    );
  }


  // ==========================================================
  // 5.13 Tool Arguments Validation
  // ==========================================================

  if (expect.tool_arguments) {
    check(
      JSON.stringify(toolCalls[0]?.arguments) ===
        JSON.stringify(expect.tool_arguments),
      'wrong tool arguments',
      failures
    );
  }


  // ==========================================================
  // 5.14 Return Test Result
  // ==========================================================

  return {
    id: testCase.id,
    category: testCase.category,
    passed: failures.length === 0,
    failures
  };
}



// 6. RUN ALL TEST CASES


const results = [
  ...visible,
  ...original
].map(runCase);



// 7. CATEGORY SUMMARY


const categories = {};

for (const result of results) {
  const category =
    categories[result.category] ||= {
      passed: 0,
      total: 0
    };

  category.total += 1;
  category.passed += Number(result.passed);
}



// 8. PRINT INDIVIDUAL RESULTS


for (const result of results) {
  console.log(
    `${result.passed ? 'PASS' : 'FAIL'} ` +
    `${result.category}: ${result.id}` +
    `${
      result.failures.length
        ? ` — ${result.failures.join('; ')}`
        : ''
    }`
  );
}



// 9. PRINT CATEGORY SUMMARY


console.log('\nCategory summary');

for (const [category, counts] of Object.entries(categories)) {
  console.log(
    `${category}: ${counts.passed}/${counts.total}`
  );
}



// 10. PRINT TOTAL SCORE


console.log(
  `TOTAL: ${
    results.filter((result) => result.passed).length
  }/${results.length}`
);



// 11. OPTIONAL: SAVE RESULTS TO JSON


if (process.argv.includes('--write')) {
  fs.writeFileSync(
    path.join(root, 'evaluation', 'results.json'),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        results,
        categories
      },
      null,
      2
    ) + '\n'
  );
}



// 12. EXIT CODE


process.exitCode = results.some(
  (result) => !result.passed
)
  ? 1
  : 0;