// Prints database product slugs and SKUs for bulk image sync: npm run slugs
const db = require('../lib/db');

(async () => {
  try {
    const products = await db.q(
      'SELECT p.slug, GROUP_CONCAT(v.sku, \', \') AS skus FROM products p LEFT JOIN variants v ON v.product_id=p.id GROUP BY p.id ORDER BY p.sort,p.id'
    );
    console.log('Name Drive images <slug>.jpg, <slug>-2.jpg ... (or a SKU), then use Catalogue > "Sync from Drive".\n');
    products.forEach((product) => console.log(product.slug.padEnd(42), product.skus || ''));
  } finally {
    await db.client.close();
  }
})().catch((error) => {
  console.error('Could not load products from the database:', error.message);
  process.exitCode = 1;
});
