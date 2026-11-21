// Initializes schema and ancillary defaults; product and category catalog data is database-managed.
const db = require('./db');
const schema = require('./schema');
const reviews = require('../data/reviews');

module.exports = async function init() {
  await db.client.executeMultiple(schema);
  const variantColumns = await db.q('PRAGMA table_info(variants)');
  if (!variantColumns.some((column) => column.name === 'images')) {
    await db.run("ALTER TABLE variants ADD COLUMN images TEXT DEFAULT '[]'");
  }
  const now = db.nowIso();
  if (!(await db.val('SELECT COUNT(*) FROM reviews'))) {
    for (const r of reviews) {
      await db.run('INSERT INTO reviews(product_slug,customer_name,city,rating,title,body,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
        [r.product, r.name, r.city, r.rating, r.title, r.text, 'approved', now]);
    }
  }
  if (!(await db.val('SELECT COUNT(*) FROM coupons'))) {
    await db.batch([
      ["INSERT INTO coupons(code,title,type,value,max_discount,min_order,expires_on) VALUES('EXTRA15','15% off up to Rs.200 (min order Rs.949)','percent',15,200,949,'2027-06-30')"],
      ["INSERT INTO coupons(code,title,type,value,max_discount,min_order,expires_on) VALUES('BUMPER10','10% off up to Rs.100 (min order Rs.599)','percent',10,100,599,'2027-06-30')"]
    ]);
  }
};
