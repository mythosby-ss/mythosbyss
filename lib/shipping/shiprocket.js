// Shiprocket adapter: placeholder. Not connected yet (paid service - needs your account).
// To connect: add SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD (an API user from Shiprocket > Settings > API) to .env, set SHIPPING_PROVIDER=shiprocket, and implement the four methods below
// with Shiprocket's API, mapping their statuses to: shipped, out_for_delivery, ndr, delivered, rto.
const notReady = async () => ({ ok: false, error: 'Shiprocket is not connected yet. Use SHIPPING_PROVIDER=manual, or finish lib/shipping/shiprocket.js.' });
module.exports = {
  name: 'shiprocket',
  label: 'Shiprocket (not connected)',
  capabilities: { autoAwb: false, liveTracking: false },
  createShipment: notReady,
  getTracking: notReady,
  cancelShipment: notReady,
  getNdrStatus: notReady
};
