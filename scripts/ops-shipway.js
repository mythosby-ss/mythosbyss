// Shipway -> ops/data/shipments.csv + remittance.csv (columns: ops/README.md).
// NOT CONNECTED YET: Shipway's API endpoints are not built in because we do not have the API docs/keys yet
// (we never guess endpoints). Until then, `npm run ops:export` writes shipments.csv from the order records
// (courier, AWB, status, NDR attempts and the charges entered on each order in admin).
//   Needs in .env: SHIPWAY_USERNAME, SHIPWAY_LICENSE_KEY  (Shipway > Settings > API)
require('dotenv').config();

const user = process.env.SHIPWAY_USERNAME; const key = process.env.SHIPWAY_LICENSE_KEY;
if (!user || !key) {
  console.log('Shipway is not connected: SHIPWAY_USERNAME / SHIPWAY_LICENSE_KEY are empty in .env.');
  console.log('For now, shipments.csv comes from `npm run ops:export` (order records). remittance.csv: export it from the Shipway dashboard into ops/data/.');
  process.exit(0);
}
console.log('Shipway keys found, but the Shipway API sync is not built yet.');
console.log('Next step: share Shipway\'s API docs (tracking/NDR, COD remittance, wallet ledger) so the calls can be added here.');
process.exit(2);
