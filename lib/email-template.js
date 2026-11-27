// Branded HTML email layout for owner emails (new order, daily report).
// Email-safe: tables + inline styles only (Gmail / Outlook / Apple Mail / phones), no external CSS, fonts or images.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const C = { ink: '#0d0d0d', gold: '#b07a2a', goldDark: '#8f6120', soft: '#f3e8d3', page: '#f4f1ec', line: '#ece6dc', muted: '#6b6b6b', white: '#ffffff' };
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";

/** Coloured pill, e.g. badge('COD', 'amber') */
const TONES = { green: ['#e7f6ec', '#17663a'], amber: ['#fdf1dc', '#8a5a00'], blue: ['#e6effc', '#1d4f91'], red: ['#fde8e8', '#a11d1d'], gold: [C.soft, C.goldDark], gray: ['#eeeeee', '#444444'] };
function badge(text, tone = 'gold') {
  const [bg, fg] = TONES[tone] || TONES.gold;
  return `<span style="display:inline-block;${FONT};padding:4px 10px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:700;letter-spacing:.3px">${esc(text)}</span>`;
}

/** Bullet-proof button (works in Outlook too) */
function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>
<td align="center" bgcolor="${C.gold}" style="border-radius:10px">
<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 32px;${FONT};font-size:15px;font-weight:700;color:${C.white};text-decoration:none;border-radius:10px">${esc(label)} &rarr;</a>
</td></tr></table>`;
}

/** Section heading inside the card */
const heading = (t) => `<p style="margin:0 0 10px;${FONT};font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.muted}">${esc(t)}</p>`;

/** Two-column label/value rows: rows = [[label, valueHtml, { bold, indent, big }], ...] (values are trusted HTML - escape before passing) */
function rows(list) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${list.map(([k, v, o = {}]) => `<tr>
<td style="padding:8px 0;${o.indent ? 'padding-left:16px;' : ''}${FONT};font-size:${o.big ? 16 : 14}px;color:${o.bold || o.big ? C.ink : C.muted};${o.bold || o.big ? 'font-weight:700;' : ''}border-bottom:1px solid ${C.line}">${esc(k)}</td>
<td align="right" style="padding:8px 0;${FONT};font-size:${o.big ? 18 : 14}px;color:${C.ink};${o.bold || o.big ? 'font-weight:700;' : ''}border-bottom:1px solid ${C.line}">${v}</td></tr>`).join('')}</table>`;
}

/** Full email: header bar, white card with `body`, footer. `preheader` = preview text shown in the inbox list. */
function layout({ title, preheader = '', eyebrow = '', body, footer = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page}">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
<tr><td style="background:${C.ink};border-radius:16px 16px 0 0;padding:20px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td style="${FONT};font-size:20px;font-weight:800;letter-spacing:.5px;color:${C.white}">MYTHOS<span style="color:${C.gold}"> by SS</span></td>
  <td align="right" style="${FONT};font-size:12px;color:#bdbdbd">${esc(eyebrow)}</td></tr></table>
</td></tr>
<tr><td style="background:${C.white};padding:28px;border-radius:0 0 16px 16px;border:1px solid ${C.line};border-top:0">${body}</td></tr>
<tr><td align="center" style="padding:16px 8px;${FONT};font-size:12px;line-height:1.5;color:${C.muted}">${footer || 'Sent automatically by your Mythos by SS store. Turn these emails on or off in Admin &rarr; Settings &rarr; Ops &amp; owner emails.'}</td></tr>
</table></td></tr></table></body></html>`;
}

module.exports = { layout, badge, button, heading, rows, esc, C, FONT };
