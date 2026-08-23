const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  createOrderLookup,
  normalizeOrderId
} = require('../src/orderLookup');


const orders = createOrderLookup(
  path.join(
    __dirname,
    '..',
    'data',
    'orders.json'
  )
);



// Order ID Normalization


test(
  'normalizes harmless order ID formatting but does not guess malformed IDs',
  () => {
    assert.equal(
      normalizeOrderId(' ord_1007 '),
      'ORD-1007'
    );


    assert.equal(
      normalizeOrderId('ORD-10O7'),
      null
    );


    assert.equal(
      normalizeOrderId('1007'),
      null
    );
  }
);



// Customer-Safe Fields


test(
  'returns only requested customer-safe fields for a valid order',
  () => {
    const result = orders.lookup(
      'ord-1007',
      {
        fields: [
          'carrier',
          'estimated_delivery'
        ]
      }
    );


    assert.deepEqual(
      result,
      {
        found: true,
        order_id: 'ORD-1007',
        status: 'shipped',
        carrier: 'UPS',
        estimated_delivery: '2026-08-22',
        handoff: false
      }
    );


    assert.doesNotMatch(
      JSON.stringify(result),
      /ava\.morgan|King Street|risk_score|fraud/i
    );
  }
);



// Cancelled Order Safety


test(
  'does not expose stale logistics after cancellation',
  () => {
    const result = orders.lookup(
      'ORD-1004',
      {
        fields: [
          'carrier',
          'tracking_number',
          'estimated_delivery'
        ]
      }
    );


    assert.equal(
      result.status,
      'cancelled'
    );


    assert.equal(
      result.customer_safe_message,
      'The order is cancelled and will not be shipped.'
    );


    assert.equal(
      'carrier' in result,
      false
    );


    assert.equal(
      'estimated_delivery' in result,
      false
    );
  }
);



// Missing Delivery Estimate


test(
  'does not invent an ETA when a shipped order has none',
  () => {
    const result = orders.lookup(
      'ORD-1011',
      {
        fields: [
          'carrier',
          'estimated_delivery'
        ]
      }
    );


    assert.equal(
      result.carrier,
      'Canada Post'
    );


    assert.equal(
      result.delivery_estimate_available,
      false
    );


    assert.equal(
      'estimated_delivery' in result,
      false
    );
  }
);



// Unknown & Malformed Order IDs


test(
  'reports unknown and malformed order IDs safely',
  () => {
    assert.deepEqual(
      orders.lookup('ORD-9999'),
      {
        found: false,
        code: 'order_not_found',
        order_id: 'ORD-9999',
        handoff: true
      }
    );


    assert.deepEqual(
      orders.lookup('not an order'),
      {
        found: false,
        code: 'malformed_order_id',
        handoff: false
      }
    );
  }
);



// Shipment Exception Handling


test(
  'marks shipment exceptions for human support review without internal data',
  () => {
    const result = orders.lookup(
      'ORD-1010',
      {
        fields: [
          'carrier',
          'tracking_number'
        ]
      }
    );


    assert.equal(
      result.status,
      'exception'
    );


    assert.equal(
      result.handoff,
      true
    );


    assert.doesNotMatch(
      JSON.stringify(result),
      /damage scan|risk|internal/i
    );
  }
);