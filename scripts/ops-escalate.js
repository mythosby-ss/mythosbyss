// npm run ops:escalate <awb>  - send the escalation drafted in ops/tickets/rto/<awb>.md (see lib/ops-escalation.js).
// Only works when ops/data/settings.csv has allow_auto_send,yes. Uses SMTP from .env.
require('dotenv').config();
const awb = process.argv[2];
if (!awb) { console.error('Usage: npm run ops:escalate <awb>'); process.exit(1); }
require('../lib/ops-escalation').sendLogisticsEscalation(awb).then((r) => {
  console.log(r.ok ? `Sent to ${r.to}: ${r.subject}` : r.error);
  process.exit(r.ok ? 0 : 1);
});
