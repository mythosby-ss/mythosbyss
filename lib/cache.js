// Tiny in-memory cache for storefront queries (banners, reviews, testimonials, add-ons).
// Entries live at most TTL ms, and every admin save clears everything (routes/admin/index.js), so edits show at once.
const TTL = 60 * 1000;
const store = new Map();
async function memo(key, fn, ttl = TTL) {
  const hit = store.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  store.set(key, { val, exp: Date.now() + ttl });
  if (store.size > 2000) store.delete(store.keys().next().value); // keep memory bounded
  return val;
}
module.exports = { memo, clear: () => store.clear() };
