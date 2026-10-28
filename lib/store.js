// Tiny JSON-file order store. Swap for MongoDB/Postgres in production.
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'orders.json');

function read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return []; } }
function write(list) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = {
  all: () => read().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  find: (id) => read().find((o) => o.id === id),
  create(order) { const l = read(); l.push(order); write(l); return order; },
  update(id, patch) {
    const l = read(); const i = l.findIndex((o) => o.id === id);
    if (i < 0) return null;
    l[i] = { ...l[i], ...patch, updatedAt: new Date().toISOString() };
    write(l); return l[i];
  }
};
