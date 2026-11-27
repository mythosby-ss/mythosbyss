// npm run ops:pincode <pincode> [--json]
// Post offices, district and state for an Indian pincode, from the public India Post pincode API (api.postalpincode.in).
// Sends ONLY the pincode - never names, phones or addresses. Results are cached in ops/cache/pincodes.json (gitignored).
// Never edits any order or customer address.
const fs = require('fs');
const path = require('path');

const pin = String(process.argv[2] || '').trim();
const asJson = process.argv.includes('--json');
if (!/^[1-9]\d{5}$/.test(pin)) { console.error('Usage: npm run ops:pincode <6-digit pincode>'); process.exit(1); }
const file = path.join(__dirname, '..', 'ops', 'cache', 'pincodes.json');
let cache = {}; try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}

async function lookup() {
  if (cache[pin]) return { ...cache[pin], cached: true };
  const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`India Post API HTTP ${r.status}`);
  const [j] = await r.json();
  const offices = (j && j.PostOffice) || [];
  const res = { pincode: pin, valid: offices.length > 0, district: offices[0] ? offices[0].District : '', state: offices[0] ? offices[0].State : '',
    postOffices: offices.map((o) => ({ name: o.Name, type: o.BranchType, delivery: o.DeliveryStatus, block: o.Block, division: o.Division })) };
  if (j && (j.Status === 'Success' || j.Status === 'Error')) { // cache definite answers only (not outages)
    cache[pin] = { ...res, fetched: new Date().toISOString().slice(0, 10) };
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(cache, null, 1));
  }
  return res;
}

lookup().then((r) => {
  if (asJson) return console.log(JSON.stringify(r, null, 2));
  if (!r.valid) return console.log(`${pin}: NOT FOUND in India Post data (wrong or non-existent pincode)${r.cached ? ' [cached]' : ''}`);
  console.log(`${pin}: ${r.district}, ${r.state}${r.cached ? ' [cached]' : ''}`);
  r.postOffices.forEach((o) => console.log(`  - ${o.name} (${o.type}, ${o.delivery})${o.block && o.block !== 'NA' ? ' · ' + o.block : ''}`));
}).catch((e) => { console.error('Lookup failed:', e.message, '- try again later; nothing was cached.'); process.exit(1); });
