// Stock reservation. A cart line of a bundle reserves its component SKUs instead of the bundle SKU.
const db = require('./db');

/** Units needed per SKU for a list of { sku, qty, components? } lines (components = [{ sku, qty }] per unit). */
function needs(lines) {
  const m = {};
  for (const l of lines) {
    const parts = l.components && l.components.length ? l.components.map((c) => ({ sku: c.sku, qty: c.qty * l.qty })) : [{ sku: l.sku, qty: l.qty }];
    for (const p of parts) m[p.sku] = (m[p.sku] || 0) + p.qty;
  }
  return m;
}

async function release(map) {
  for (const [sku, qty] of Object.entries(map)) await db.run('UPDATE variants SET stock = stock + ? WHERE sku=?', [qty, sku]);
}

/** Atomically (per SKU) take stock. On failure everything taken so far is put back. Returns { ok, sku? }. */
async function reserve(map) {
  const taken = {};
  for (const [sku, qty] of Object.entries(map)) {
    const r = await db.run('UPDATE variants SET stock = stock - ? WHERE sku=? AND stock >= ?', [qty, sku, qty]);
    if (!r.changes) { await release(taken); return { ok: false, sku }; }
    taken[sku] = qty;
  }
  return { ok: true };
}

module.exports = { needs, reserve, release };
