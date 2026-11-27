// Small CSV helpers for the ops/ workspace (ops/README.md) + reader for ops/data/settings.csv.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'ops');
// Where the daily data files are read from (ops/data by default; OPS_DATA_DIR=ops/data/sample for test runs). settings.csv always stays in ops/data.
const dataDir = () => path.resolve(process.env.OPS_DATA_DIR || path.join(ROOT, 'data'));

/** Quote a value for CSV (commas, quotes, new lines). Leading = + - @ are prefixed with ' so spreadsheets never run them as formulas. */
function cell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (cols, rows) => [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';

/** Parse CSV text into an array of objects (first row = headers). Handles quoted fields. */
function parse(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const readCsv = (file) => { try { return parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }; // null = file missing

/** ops/data/settings.csv as { key: value }. Missing file = {}. */
function opsSettings(dir = path.join(ROOT, 'data')) {
  return Object.fromEntries((readCsv(path.join(dir, 'settings.csv')) || []).map((r) => [r.key, r.value]));
}

module.exports = { ROOT, dataDir, toCsv, parse, readCsv, opsSettings, cell };
