// /media/:id  - proxies a public Drive file thumbnail so images load reliably (and WhatsApp can fetch them).
const router = require('express').Router();
const cache = new Map();
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^[\w-]{15,80}$/.test(id)) return res.status(404).end();
  const size = req.query.sz === 'sm' ? 'w500' : 'w1200';
  const key = id + size;
  try {
    let hit = cache.get(key);
    if (!hit) {
      for (const url of [
        `https://drive.google.com/thumbnail?id=${id}&sz=${size}`,
        `https://drive.google.com/uc?export=view&id=${id}`,
        `https://drive.google.com/uc?export=download&id=${id}`
      ]) {
        const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
        const type = r.headers.get('content-type') || '';
        if (!r.ok || !type.startsWith('image/')) continue;
        hit = { type, buf: Buffer.from(await r.arrayBuffer()) };
        break;
      }
      if (!hit) return res.redirect('/images/placeholder.svg');
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      cache.set(key, hit);
    }
    res.set({ 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=604800', 'Cross-Origin-Resource-Policy': 'cross-origin' }).send(hit.buf);
  } catch (e) {
    console.error(`Drive image proxy failed for ${id}:`, e.message);
    res.redirect('/images/placeholder.svg');
  }
});
module.exports = router;
