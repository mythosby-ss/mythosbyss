// Shipping adapter. Pick the provider with SHIPPING_PROVIDER in .env: manual (default) | shiprocket | shipway.
//
// Every adapter implements the same interface (all methods async, never throw; they return { ok, error?, ... }):
//   createShipment(order, input)  -> { ok, courier, awb }          book a pickup / assign an AWB
//   getTracking(order)            -> { ok, status, events: [...] }  latest courier status (our status names)
//   cancelShipment(order)         -> { ok, note }                   cancel with the courier
//   getNdrStatus(order)           -> { ok, ndr, reason, attempts }  failed-delivery (NDR) details
//   capabilities                  -> { autoAwb, liveTracking }       what the admin UI can offer
//
// Status names used everywhere: shipped, out_for_delivery, ndr (delivery attempted / failed), delivered, rto.
// Courier status pushes can also arrive at POST /webhooks/shipping (routes/webhooks.js).
const providers = {
  manual: require('./manual'),
  shiprocket: require('./shiprocket'),
  shipway: require('./shipway')
};

function get() {
  const name = String(process.env.SHIPPING_PROVIDER || 'manual').toLowerCase();
  return providers[name] || providers.manual;
}

module.exports = { get, providers };
