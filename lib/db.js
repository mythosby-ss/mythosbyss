// Database layer. Uses libSQL: Turso (free tier, 5 GB) in production, or a local SQLite file in development.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || process.env.DB_URL || 'file:data/mythosbyss.db';
if (url.startsWith('file:')) fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.DB_TOKEN || undefined;
const client = createClient({ url, authToken });

const toObjs = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
const q = async (sql, args = []) => toObjs(await client.execute({ sql, args }));
const one = async (sql, args = []) => (await q(sql, args))[0];
const val = async (sql, args = [], d = 0) => { const r = await one(sql, args); return r ? Object.values(r)[0] ?? d : d; };
const run = async (sql, args = []) => {
  const r = await client.execute({ sql, args });
  return { changes: r.rowsAffected, id: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null };
};
const batch = (stmts) => client.batch(stmts.map(([sql, args = []]) => ({ sql, args })), 'write');
const nowIso = () => new Date().toISOString();

module.exports = { client, q, one, val, run, batch, nowIso };
