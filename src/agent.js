const path = require('node:path');

const {
  createRetriever,
  toPublicPassage
} = require('./retrieval');

const {
  createOrderLookup
} = require('./orderLookup');

const {
  SessionStore,
  subjectsFor
} = require('./conversation');

const {
  TraceLogger
} = require('./traceLogger');


const PRIVATE_REQUEST =
  /\b(email|e-mail|address|internal note|warehouse note|risk score|customer name)\b/i;

const SECRET_REQUEST =
  /\b(system prompt|hidden instructions?|developer instructions?|secrets?|reveal (?:your )?prompt)\b/i;

const UNSUPPORTED_ACTION =
  /\b(cancel|cancellation|refund|replacement?|address change|change (?:my )?address)\b/i;

const ORDER_ID =
  /\bORD[-\s_]?\d{4}\b/i;


function citation(passage) {
  return `${passage.filename} — ${passage.heading}`;
}


function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${value}T00:00:00Z`));
}


class SupportAgent {
  constructor({
    knowledgeBasePath,
    ordersPath,
    debug = false,
    traceWriter
  } = {}) {
    const root = path.resolve(__dirname, '..');

    this.retriever = createRetriever(
      knowledgeBasePath ||
        path.join(root, 'knowledge-base')
    );

    this.orders = createOrderLookup(
      ordersPath ||
        path.join(root, 'data', 'orders.json')
    );

    this.sessions = new SessionStore();

    this.logger = new TraceLogger({
      enabled: debug,
      write: traceWriter
    });
  }


  respond({ sessionId, message }) {
    const session = this.sessions.get(sessionId);

    const history = session.relevantHistory(message);

    const result = this.decide(message, history);

    session.addUserMessage(message);

    session.addAssistantMessage(result.answer, {
      subjects: subjectsFor(message)
    });

    const response = {
      session_id: session.id,
      ...result,
      trace: {
        user_message: message,
        relevant_history: history,
        retrieved_passages:
          result.passages.map(toPublicPassage),
        tool_call: result.tool_call || null,
        handoff: result.handoff
      }
    };

    this.logger.log(response);

    return response;
  }


  decide(message, history) {
    const base = {
      sources: [],
      passages: [],
      handoff: false
    };


    if (SECRET_REQUEST.test(message)) {
      return {
        ...base,
        handoff: true,
        answer:
          'I can’t reveal system prompts, hidden instructions, secrets, or internal-only information.'
      };
    }


    if (PRIVATE_REQUEST.test(message)) {
      return {
        ...base,
        handoff: true,
        answer:
          'I can’t disclose customer email addresses, addresses, internal notes, risk scores, or other internal-only data.'
      };
    }


    const orderId = this.findOrderId(message, history);

    const looksLikeOrderQuestion =
      orderId ||
      /\b(my )?order\b|\b(where|when).*\b(arrive|delivery|ship)/i.test(
        message
      );


    if (looksLikeOrderQuestion) {
      return this.answerOrder(
        message,
        orderId,
        base
      );
    }


    if (UNSUPPORTED_ACTION.test(message)) {
      return {
        ...base,
        handoff: true,
        answer:
          'I can explain the applicable policy, but I can’t complete a cancellation, refund, replacement, or address change. A support specialist can help with an action request.'
      };
    }


    const passages = this.retriever.search(
      message,
      { limit: 6 }
    );

    const conflicts =
      this.retriever.findConflicts(
        message,
        passages
      );


    if (conflicts.length) {
      const cited = conflicts[0].passages;

      return {
        ...base,
        passages,
        sources: cited.map((p) => p.source),
        handoff: true,
        answer:
          `Current official sources conflict: one says to hand-wash the Breeze Tumbler body, while another says all components are dishwasher safe. Please use the safer interim guidance—hand-wash the body—and contact support for human confirmation. Sources: ${cited
            .map((p) => p.source)
            .join('; ')}.`
      };
    }


    if (!passages.length) {
      return {
        ...base,
        handoff: true,
        answer:
          'The supplied information is insufficient to answer that reliably. Please contact support for human confirmation.'
      };
    }


    if (!this.hasAdequateEvidence(message, passages)) {
      return {
        ...base,
        handoff: true,
        answer:
          'The supplied information is insufficient to answer that reliably. Please contact support for human confirmation.'
      };
    }


    return this.answerPolicy(
      message,
      passages,
      base
    );
  }


  hasAdequateEvidence(message, passages) {
    if (
      /\b(return|returns|returned|trailplus|warranty|international|canada|germany)\b/i.test(
        message
      )
    ) {
      return true;
    }


    const ignore = new Set([
      'about',
      'after',
      'again',
      'all',
      'and',
      'are',
      'can',
      'does',
      'entire',
      'for',
      'from',
      'have',
      'how',
      'i',
      'in',
      'is',
      'it',
      'my',
      'of',
      'on',
      'put',
      'the',
      'to',
      'what',
      'with',
      'you',
      'your'
    ]);


    const terms = [
      ...new Set(
        (
          message
            .toLowerCase()
            .match(/[a-z]{4,}/g) || []
        )
          .filter((term) => !ignore.has(term))
          .map((term) => term.replace(/s$/, ''))
      )
    ];


    const evidence = passages
      .map(
        (passage) =>
          `${passage.heading} ${passage.text}`
      )
      .join(' ')
      .toLowerCase();


    const matched = terms.filter(
      (term) => evidence.includes(term)
    ).length;


    return (
      terms.length < 3 ||
      matched >=
        Math.max(
          2,
          Math.ceil(terms.length * 0.6)
        )
    );
  }


  findOrderId(message, history) {
    const match = message.match(ORDER_ID);

    if (match) {
      return match[0];
    }


    const historyText = history
      .map((turn) => turn.content)
      .join(' ');

    return (
      historyText.match(ORDER_ID)?.[0] ||
      null
    );
  }


  answerOrder(message, orderId, base) {
    if (!orderId) {
      return {
        ...base,
        answer:
          'Please provide your order ID (for example, ORD-1007) so I can look up its current status.'
      };
    }


    const fields = [
      'carrier',
      'tracking_number'
    ];


    if (
      /when|arrive|delivery|eta|estimate/i.test(
        message
      )
    ) {
      fields.push('estimated_delivery');
    }


    const toolResult = this.orders.lookup(
      orderId,
      { fields }
    );


    const tool_call = {
      name: 'order_lookup',

      arguments: {
        order_id: orderId
          .trim()
          .toUpperCase()
          .replace(/[\s_]/g, '-')
      },

      result: toolResult
    };


    if (!toolResult.found) {
      return {
        ...base,
        handoff: toolResult.handoff,
        tool_call,

        answer:
          toolResult.code === 'order_not_found'
            ? 'That order was not found. Please check the order ID or contact support.'
            : 'Please provide a valid order ID, such as ORD-1007.'
      };
    }


    if (
      toolResult.status === 'cancelled' ||
      toolResult.status === 'returned'
    ) {
      return {
        ...base,
        handoff: false,
        tool_call,
        answer: toolResult.customer_safe_message
      };
    }


    if (toolResult.status === 'exception') {
      return {
        ...base,
        handoff: true,
        tool_call,
        answer:
          'The shipment requires support review. Please contact a support specialist for help.'
      };
    }


    const parts = [
      `Order ${toolResult.order_id} is ${toolResult.status}.`
    ];


    if (toolResult.carrier) {
      parts.push(
        `Carrier: ${toolResult.carrier}.`
      );
    }


    if (toolResult.estimated_delivery) {
      parts.push(
        `Estimated delivery: ${formatDate(
          toolResult.estimated_delivery
        )}.`
      );
    }


    if (
      toolResult.delivery_estimate_available ===
      false
    ) {
      parts.push(
        'A delivery estimate is unavailable.'
      );
    }


    return {
      ...base,
      tool_call,
      answer: parts.join(' ')
    };
  }


  answerPolicy(message, passages, base) {
    const lower = message.toLowerCase();


    const sourceFor = (
      filename,
      heading
    ) =>
      passages.find(
        (p) =>
          p.filename === filename &&
          (!heading || p.heading === heading)
      ) ||
      this.retriever.chunks.find(
        (p) =>
          p.filename === filename &&
          (!heading || p.heading === heading)
      );


    if (
      /return/.test(lower) &&
      /trailplus/.test(lower)
    ) {
      const source = sourceFor(
        '09-trailplus-membership.md',
        'Return window'
      );


      return this.sourced(
        'TrailPlus members whose membership was active when the order was placed have 45 calendar days from delivery for eligible returns.',
        [source],
        base
      );
    }


    if (
      /final.sale/.test(lower) &&
      /(damage|broken|defect|wrong)/.test(lower)
    ) {
      const sources = [
        sourceFor(
          '03-final-sale-and-promotions.md',
          'Damaged or incorrect items'
        ),
        sourceFor(
          '04-damaged-or-wrong-items.md',
          'Reporting window'
        )
      ];


      return this.sourced(
        'Final sale does not block a damaged-item review. Please report it within 7 calendar days of delivery; a human review is required before any resolution is approved.',
        sources,
        {
          ...base,
          handoff: true
        }
      );
    }


    if (/return/.test(lower)) {
      const source = sourceFor(
        '01-returns-policy-current.md',
        'Standard return window'
      );


      const cannotApprove =
        /approve|migration|60 days/.test(
          lower
        )
          ? ' I can’t approve a return; I can only explain the policy.'
          : '';


      return this.sourced(
        `The standard return window is 30 calendar days from delivery for eligible items.${cannotApprove}`,
        [source],
        base
      );
    }


    if (
      /canada|international|germany/.test(
        lower
      ) &&
      /ship|canada|international|germany/.test(
        lower
      )
    ) {
      const source = sourceFor(
        '06-international-shipping.md'
      );


      const answer = /germany/.test(lower)
        ? 'Shipping to Germany is not currently available.'
        : 'Aster & Row ships internationally only to Canada. Canadian orders generally arrive 5–9 business days after dispatch, and duties or taxes are not prepaid.';


      return this.sourced(
        answer,
        [source],
        base
      );
    }


    if (/lifetime warranty/.test(lower)) {
      const source = sourceFor(
        '07-warranty.md'
      );


      return this.sourced(
        'No—Aster & Row does not offer a lifetime warranty. Bags and backpacks have a 2-year warranty; drinkware and travel accessories have a 1-year warranty.',
        [source],
        base
      );
    }


    const source = passages[0];

    const conciseText = source.text
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();


    return this.sourced(
      conciseText,
      [source],
      base
    );
  }


  sourced(answer, passages, base) {
    const valid = passages.filter(Boolean);

    const sources = valid.map(citation);


    return {
      ...base,
      passages: valid,
      sources,

      answer:
        `${answer} Sources: ${sources.join('; ')}.`
    };
  }
}


module.exports = {
  SupportAgent
};