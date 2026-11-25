// Manual shipping: you book the courier yourself (courier portal / aggregator app) and type the courier name,
// AWB number and each status change in the admin. Nothing is sent anywhere.
module.exports = {
  name: 'manual',
  label: 'Manual (courier name + AWB entered by hand)',
  capabilities: { autoAwb: false, liveTracking: false },

  async createShipment(order, { courier, awb } = {}) {
    courier = String(courier || '').trim(); awb = String(awb || '').trim();
    if (!courier || !awb) return { ok: false, error: 'Courier and AWB are required to mark an order as shipped.' };
    if (!/^[A-Za-z0-9-]{4,40}$/.test(awb)) return { ok: false, error: 'AWB should be 4-40 letters, digits or dashes.' };
    return { ok: true, courier: courier.slice(0, 60), awb };
  },

  async getTracking(order) {
    return { ok: true, status: order.status, events: (order.events || []).filter((e) => e.status).map((e) => ({ status: e.status, at: e.at, note: e.note })) };
  },

  async cancelShipment(order) {
    return { ok: true, note: order.awb ? `Cancel AWB ${order.awb} with ${order.courier || 'the courier'} yourself (manual shipping).` : 'No shipment booked.' };
  },

  async getNdrStatus(order) {
    return { ok: true, ndr: order.status === 'ndr', reason: order.ndr_reason || '', attempts: order.ndr_count || 0 };
  }
};
