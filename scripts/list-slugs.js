// Prints the image file name each product expects:  npm run slugs
const { products } = require('../lib/catalog');
console.log('Save images in public/images/products/ using these names (.jpg/.png/.webp).');
console.log('Extra gallery images: <slug>-2.jpg, <slug>-3.jpg ...\n');
products.forEach((p) => console.log(p.slug.padEnd(42), p.variants.map((v) => v.sku).join(', ')));
