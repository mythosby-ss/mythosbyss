// Shipway adapter: placeholder. Not connected yet (paid service - needs your account).
// To connect: add SHIPWAY_USERNAME and SHIPWAY_LICENSE_KEY (Shipway > Settings > API) to .env, set SHIPPING_PROVIDER=shipway, and implement the four methods below
// with Shipway's API, mapping their statuses to: shipped, out_for_delivery, ndr, delivered, rto.
const notReady = async () => ({ ok: false, error: 'Shipway is not connected yet. Use SHIPPING_PROVIDER=manual, or finish lib/shipping/shipway.js.' });
module.exports = {
  name: 'shipway',
  label: 'Shipway (not connected)',
  capabilities: { autoAwb: false, liveTracking: false },
  createShipment: notReady,
  getTracking: notReady,
  cancelShipment: notReady,
  getNdrStatus: notReady
};
