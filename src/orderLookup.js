const fs = require('node:fs');



// Safe Fields


const SAFE_FIELDS = new Set([
  'membership_tier',
  'items',
  'placed_at',
  'status',
  'status_updated_at',
  'shipped_at',
  'delivered_at',
  'carrier',
  'tracking_number',
  'estimated_delivery',
  'customer_safe_message'
]);



// Order Status Configuration


const TERMINAL_NON_SHIPPING_STATUSES =
  new Set([
    'cancelled',
    'returned'
  ]);


const SHIPPING_FIELDS =
  new Set([
    'carrier',
    'tracking_number',
    'estimated_delivery',
    'shipped_at',
    'delivered_at'
  ]);



// Normalize Order ID


function normalizeOrderId(value) {
  if (typeof value !== 'string') {
    return null;
  }


  const compact = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');


  const match =
    compact.match(/^ORD(\d{4})$/);


  return match
    ? `ORD-${match[1]}`
    : null;
}



// Sanitize Order Items


function safeItems(items) {
  return items.map(
    ({
      name,
      quantity,
      final_sale
    }) => ({
      name,
      quantity,
      final_sale
    })
  );
}



// Create Order Lookup


function createOrderLookup(ordersPath) {
  const dataset = JSON.parse(
    fs.readFileSync(
      ordersPath,
      'utf8'
    )
  );


  const byId = new Map(
    dataset.orders.map(
      (order) => [
        order.order_id,
        order
      ]
    )
  );


  /**
   * Return a deliberately narrow,
   * customer-safe result.
   *
   * Raw records never cross this boundary,
   * so customer and internal fields cannot
   * reach an LLM or UI.
   */

  function lookup(
    orderId,
    { fields = ['status'] } = {}
  ) {

    // --------------------------------------------------------
    // Validate Order ID
    // --------------------------------------------------------

    const normalizedOrderId =
      normalizeOrderId(orderId);


    if (!normalizedOrderId) {
      return {
        found: false,
        code: 'malformed_order_id',
        handoff: false
      };
    }


    // --------------------------------------------------------
    // Find Order
    // --------------------------------------------------------

    const order =
      byId.get(normalizedOrderId);


    if (!order) {
      return {
        found: false,
        code: 'order_not_found',
        order_id: normalizedOrderId,
        handoff: true
      };
    }


    // --------------------------------------------------------
    // Filter Requested Fields
    // --------------------------------------------------------

    const requested = new Set(
      fields.filter(
        (field) =>
          SAFE_FIELDS.has(field)
      )
    );


    // Status is always safe and always returned.
    requested.add('status');


    const result = {
      found: true,
      order_id: order.order_id,
      status: order.status
    };


    // --------------------------------------------------------
    // Build Safe Result
    // --------------------------------------------------------

    for (const field of requested) {

      // Do not expose shipping information for
      // cancelled or returned orders.

      if (
        field === 'status' ||
        (
          TERMINAL_NON_SHIPPING_STATUSES.has(
            order.status
          ) &&
          SHIPPING_FIELDS.has(field)
        )
      ) {
        continue;
      }


      if (field === 'items') {
        result.items =
          safeItems(order.items);

      } else if (
        order[field] !== undefined &&
        order[field] !== null
      ) {
        result[field] =
          order[field];
      }
    }


    // --------------------------------------------------------
    // Handle Terminal Statuses
    // --------------------------------------------------------

    // Current status wins over stale logistics
    // fields and controls handoff.

    if (
      TERMINAL_NON_SHIPPING_STATUSES.has(
        order.status
      )
    ) {

      result.customer_safe_message =
        order.status === 'cancelled'
          ? 'The order is cancelled and will not be shipped.'
          : 'The order was returned and is no longer in delivery.';

    } else if (
      order.status === 'exception'
    ) {

      // ------------------------------------------------------
      // Exception Status
      // ------------------------------------------------------

      result.customer_safe_message =
        'The shipment requires support review.';

      result.handoff = true;

    } else {

      // ------------------------------------------------------
      // Normal Status
      // ------------------------------------------------------

      result.handoff = false;
    }


    // --------------------------------------------------------
    // Delivery Estimate Availability
    // --------------------------------------------------------

    if (
      order.status === 'shipped' &&
      !order.estimated_delivery &&
      requested.has('estimated_delivery')
    ) {
      result.delivery_estimate_available =
        false;
    }


    return result;
  }


  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  return {
    lookup,
    snapshotAt: dataset.snapshot_at
  };
}



// Exports


module.exports = {
  normalizeOrderId,
  createOrderLookup
};