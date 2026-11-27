// sendLogisticsEscalation(awb): email the escalation drafted by the RTO Desk agent in ops/tickets/rto/<awb>.md
// to the logistics partner (logistics_escalation_email in ops/data/settings.csv), over SMTP (.env).
// Refuses unless ops/data/settings.csv has allow_auto_send,yes. Every send (or failure) is logged in the ticket's Follow-up log.
// (Shipway's NDR API can be added here once its docs are available; until then email is used.)
//
// Ticket format expected (written by .claude/agents/rto-desk.md):
//   ## Escalation draft
//   To: ops@courier.example        (optional; defaults to logistics_escalation_email)
//   Subject: NDR escalation – AWB 123 – Order MB... – FAKE ATTEMPT
//   <blank line>
//   <body ... until the next "## " heading>
const fs = require('fs');
const path = require('path');
const mailer = require('./mailer');
const { opsSettings, ROOT } = require('./opscsv');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

function parseDraft(md) {
  const m = md.match(/^##\s+Escalation draft[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
  if (!m) return null;
  const lines = m[1].replace(/^```\w*\n?|```\s*$/gm, '').split('\n');
  let to = ''; let subject = ''; const body = [];
  for (const l of lines) {
    if (!subject && /^to:/i.test(l.trim()) && !body.length) { to = l.trim().slice(3).trim(); continue; }
    if (!subject && /^subject:/i.test(l.trim())) { subject = l.trim().slice(8).trim(); continue; }
    if (subject) body.push(l);
  }
  const text = body.join('\n').trim();
  return subject && text ? { to, subject, text } : null;
}

function appendLog(file, md, row) {
  const line = `| ${today()} | ${row.replace(/\|/g, '/').replace(/\n/g, ' ')} | | |`;
  const i = md.search(/^##\s+Follow-up log/m);
  if (i < 0) return fs.writeFileSync(file, md.replace(/\s*$/, '') + `\n\n## Follow-up log\n| Date | Action | Logistics reply | Next step |\n|---|---|---|---|\n${line}\n`);
  const next = md.slice(i + 3).search(/^##\s/m);
  const end = next < 0 ? md.length : i + 3 + next;
  const before = md.slice(0, end).replace(/\s*$/, '');
  fs.writeFileSync(file, `${before}\n${line}\n${next < 0 ? '' : '\n' + md.slice(end)}`);
}

async function sendLogisticsEscalation(awb, { root = ROOT } = {}) {
  const s = opsSettings(path.join(root, 'data'));
  if (String(s.allow_auto_send || '').toLowerCase() !== 'yes') return { ok: false, refused: true, error: 'Refused: allow_auto_send is not "yes" in ops/data/settings.csv. Send the draft yourself, or turn auto-send on.' };
  if (!/^[A-Za-z0-9-]{4,40}$/.test(String(awb || ''))) return { ok: false, error: 'Invalid AWB.' };
  const file = path.join(root, 'tickets', 'rto', `${awb}.md`);
  if (!fs.existsSync(file)) return { ok: false, error: `No ticket at ops/tickets/rto/${awb}.md` };
  const md = fs.readFileSync(file, 'utf8');
  const draft = parseDraft(md);
  if (!draft) return { ok: false, error: 'The ticket has no "## Escalation draft" section with a Subject line and a body.' };
  const to = draft.to || s.logistics_escalation_email || '';
  if (!EMAIL.test(to)) return { ok: false, error: 'No valid recipient: set logistics_escalation_email in ops/data/settings.csv.' };
  const r = await mailer.send({ to, subject: draft.subject, text: draft.text });
  appendLog(file, md, r.ok ? `Escalation email sent to ${to} ("${draft.subject}", id ${r.id || '-'})` : `Escalation email to ${to} FAILED: ${r.error}`);
  return { ...r, to, subject: draft.subject };
}

module.exports = { sendLogisticsEscalation, parseDraft };
