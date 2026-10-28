/**
 * Product data extracted from "MythosBySS B2B Catalog (Updated).pdf".
 *
 * Variant tuple:  [label, itemCode, priceINR, masterPackPcs]
 *  - itemCode is the catalog code; the SKU becomes  MB-NK-N-<itemCode>
 *  - masterPackPcs is the carton quantity from the catalog table (wholesale info)
 *
 * !! The PDF has NO prices. Every price below is a PLACEHOLDER - replace with real
 *    selling prices. MRP is auto-computed as 2x price ("Save min 50%" banner).
 */
const categories = [
  { slug: 'casserole',     name: 'Casserole',     blurb: 'Double-walled insulated casseroles that keep food hot and fresh for hours.' },
  { slug: 'water-jug',     name: 'Water Jug',     blurb: 'Insulated water jugs for home, office, travel, shops and hospitals.' },
  { slug: 'water-bottle',  name: 'Water Bottle',  blurb: 'Leak-proof bottles in steel and BPA-free plastic, from school kids to gym-goers.' },
  { slug: 'flask',         name: 'Flask',         blurb: 'Unbreakable flasks for piping hot tea, coffee and soups, or ice-cold drinks.' },
  { slug: 'tiffin-box',    name: 'Tiffin Box',    blurb: 'Layered tiffins with stainless steel containers for office, school and travel.' },
  { slug: 'lunch-box',     name: 'Lunch Box',     blurb: 'Leak-proof, compartment lunch boxes with cutlery for every appetite.' },
  { slug: 'mug',           name: 'Mug',           blurb: 'Stainless steel inside, easy-grip outside.' },
  { slug: 'serving-tray',  name: 'Serving Tray',  blurb: 'Printed trays that lift the look of your kitchen and dining area.' },
  { slug: 'container',     name: 'Container',     blurb: 'Airtight storage, jar sets and spice shakers for a tidy kitchen.' },
  { slug: 'jug-glass',     name: 'Jug & Glass',   blurb: 'Serve drinks in style with sturdy jugs and glasses.' },
  { slug: 'pencil-box',    name: 'Pencil Box',    blurb: 'Two-portion pencil boxes with fun prints for school.' },
  { slug: 'combo-set',     name: 'Combo Set',     blurb: 'Gift-ready combos that pair casseroles, jugs, tiffins and bottles.' }
];

const D = {
  casserole: 'The perfect serving casserole for any special occasion or household gathering like a birthday or anniversary party. The double-walled inner stainless steel casserole keeps food hot and fresh for hours.',
  jug: 'Ideal for travels, home, office, shops, hotels, hospitals and classrooms. For best results, always fill to full capacity.',
  bottle: 'A leak-proof design with a stylish shape that is easy to grip. The wide mouth makes filling and cleaning easy.',
  flask: 'Keeps piping hot tea, coffee, hot beverages and soups hot, or drinks ice-cold, for long hours.',
  tiffin: 'Easy-to-carry stainless steel tiffin in a durable plastic body. Ideal for picnics, tours, travelling, office and school.',
  lunch: 'Perfect for meals and food storage. Ideal for office executives, school students, kids and college students.',
  lunchSS: 'Premium quality lunch box with a locking lid system, 1 spoon and a small container. 100% stainless steel and heavy plastic materials. Easy to clean.',
  tray: 'Comes in an attractive printed colour that elevates the look of your kitchen and dining area.',
  pencil: 'A unique printed top box that your child can carry to school, with separate slots for pencils, rubber, eraser and geometry set.'
};

// P(category, name, description, variants, extras)
const P = (category, name, desc, variants, extra = {}) => ({ category, name, desc, variants, ...extra });
const ml = (n) => `${n} ml`;

const products = [
  /* ---------------- CASSEROLE ---------------- */
  P('casserole', 'Crystal Casserole', D.casserole, [[ml(3500),'101',1299,72],[ml(2500),'102',999,96],[ml(1500),'103',749,128]], { f: ['Glass see-through lid', 'Metallic pattern band', 'Double-walled, stainless steel inner'] }),
  P('casserole', 'Cosmos Casserole', D.casserole, [[ml(3700),'104',799,60],[ml(2700),'105',599,96]], { f: ['Floral print body', 'Soft-touch lid knob'] }),
  P('casserole', 'Royal King Hot Pot', D.casserole, [[ml(3500),'106',699,60],[ml(2500),'107',549,96],[ml(1500),'108',399,120]], { f: ['Contrast grip handles', 'Printed floral design'] }),
  P('casserole', 'Royal Star Hot Pot', D.casserole, [[ml(4500),'109',849,54],[ml(3200),'110',649,72],[ml(2200),'114',499,105]], { f: ['Ribbed body', 'Leaf-embossed lid'] }),
  P('casserole', 'Deluxe Casserole', D.casserole, [[ml(3500),'115',899,72]], { f: ['Diamond-cut textured body', 'Stainless steel inner'] }),

  /* ---------------- WATER JUG ---------------- */
  P('water-jug', 'Wild Water Jug', D.jug, [[ml(7000),'201',1799,40],[ml(5000),'202',1399,45]], { f: ['Sturdy tripod legs', 'Easy-pour tap'] }),
  P('water-jug', 'Cool Star Water Jug', D.jug, [[ml(12000),'203',2199,24],[ml(5000),'206',1199,50],[ml(3500),'207',899,72],[ml(3000),'208',799,100]], { f: ['"Save Tree" embossed body', 'Carry handle', 'Push tap'] }),
  P('water-jug', 'Dolphin Water Jug', D.jug, [[ml(8000),'210',1499,32],[ml(6000),'211',1199,48],[ml(4500),'212',899,72],[ml(3000),'213',699,80]], { f: ['Ribbed grip body', 'Wide-mouth lid'] }),
  P('water-jug', 'CoolPro Water Jug', D.jug, [[ml(5000),'214',1099,72]], { f: ['Tree-embossed body', 'Carry handle'] }),

  /* ---------------- WATER BOTTLE ---------------- */
  P('water-bottle', 'Paris Water Bottle', D.bottle, [[ml(1800),'301',349,108],[ml(1500),'302',299,108],[ml(1200),'303',249,108]], { badge: 'Premium range' }),
  P('water-bottle', 'Bahubali Water Bottle', D.bottle, [[ml(2600),'304',399,108]]),
  P('water-bottle', 'Bullet Water Bottle', D.bottle, [[ml(2500),'305',349,108],[ml(1200),'306',229,144]]),
  P('water-bottle', 'Casual Water Bottle', D.bottle, [[ml(2200),'307',329,108],[ml(1700),'308',279,108],[ml(1200),'309',219,192]]),
  P('water-bottle', 'Nexon Water Bottle', D.bottle, [[ml(2400),'310',339,108],[ml(1200),'311',219,144]], { f: ['Honeycomb texture', 'Carry strap'] }),
  P('water-bottle', 'Cool Campash Water Bottle', D.bottle, [[ml(2000),'312',399,108],[ml(1700),'313',349,112],[ml(1400),'314',299,144],[ml(1100),'315',249,144]]),
  P('water-bottle', 'Baby Doll Water Bottle', D.bottle, [[ml(800),'330',249,216],[ml(600),'331',199,288]], { f: ['Kids print', 'Shoulder strap'] }),
  P('water-bottle', 'Steel Well Water Bottle', D.bottle, [[ml(1000),'333',449,216],[ml(800),'334',399,216],[ml(600),'335',349,216]], { f: ['Stainless steel body', 'Hot & cold'] }),
  P('water-bottle', 'Tokyo Water Bottle', D.bottle, [[ml(1000),'336',249,216]], { f: ['Flip-top lid', 'Wrist strap'] }),
  P('water-bottle', 'Kohinoor Water Bottle', D.bottle, [[ml(1200),'337',299,192]], { f: ['Faceted body', 'Flip-top lid'] }),
  P('water-bottle', 'Hector Water Bottle', D.bottle, [[ml(1100),'342',269,216],[ml(900),'343',229,216]], { f: ['Sip-through flip lid', 'Carry strap'] }),
  P('water-bottle', 'Jolly Water Bottle', D.bottle, [[ml(800),'344',249,216],[ml(600),'345',199,288]], { f: ['Kids print', 'Shoulder strap'] }),
  P('water-bottle', 'Bunny Water Bottle', D.bottle, [[ml(800),'346',249,216],[ml(600),'347',199,288]], { f: ['Kids print', 'Shoulder strap'] }),
  P('water-bottle', 'Bella Water Bottle', D.bottle, [[ml(800),'348',249,216],[ml(600),'349',199,288]], { f: ['Kids print', 'Flip-top lid'] }),
  P('water-bottle', 'Rubby Water Bottle', D.bottle, [[ml(600),'350',219,288]], { f: ['Bunny-ear handle', 'Straw lid'] }),
  P('water-bottle', 'Zara Water Bottle', D.bottle, [[ml(600),'351',229,288]], { f: ['Straw dome lid', 'Shoulder strap'] }),
  P('water-bottle', 'Joyo Water Bottle', D.bottle, [[ml(600),'352',249,288]], { f: ['Twin grip handles', 'Straw lid'] }),
  P('water-bottle', 'Antic Water Bottle', D.bottle, [[ml(600),'353',199,288]], { f: ['Screw cap', 'Printed kids sleeve'] }),
  P('water-bottle', 'Hydro Water Bottle', D.bottle, [[ml(800),'354',229,288]], { f: ['Flip lid', 'Carry strap'] }),
  P('water-bottle', 'Noori Water Bottle', D.bottle, [[ml(800),'355',299,216]], { n: 1, f: ['Push-button straw lid', 'Window panel', 'Shoulder strap'] }),
  P('water-bottle', 'Alexa Water Bottle', D.bottle, [[ml(800),'356',349,216]], { n: 1, f: ['Push-button straw lid', 'Shoulder strap'] }),
  P('water-bottle', 'Teddy Water Bottle', D.bottle, [[ml(700),'357',279,288]], { n: 1, f: ['Teddy-bear shape', 'Push-button straw lid'] }),
  P('water-bottle', 'Unicorn Water Bottle', D.bottle, [[ml(1000),'358',329,288]], { n: 1, f: ['Push-button lid', 'Kids print'] }),
  P('water-bottle', 'Bumper Water Bottle', D.bottle, [[ml(1100),'360',279,216]], { f: ['Ribbed body', 'Carry handle'] }),
  P('water-bottle', 'Premium Steel Water Bottle', D.bottle, [[ml(1000),'1001',549,192],[ml(750),'1002',449,216],[ml(500),'1003',349,288]], { f: ['Stainless steel', 'Carry loop'] }),

  /* ---------------- FLASK ---------------- */
  P('flask', 'Thermos Unbreakable Flask', D.flask, [[ml(3200),'401',1199,56],[ml(2200),'402',899,64],[ml(1700),'403',749,90],[ml(1200),'404',599,96],[ml(800),'405',449,120],[ml(600),'406',349,120]], { f: ['Unbreakable body', 'Easy-grip handle'] }),

  /* ---------------- TIFFIN BOX ---------------- */
  P('tiffin-box', 'Crazy Tiffin Box', D.tiffin, [['4 Layer','501',699,72],['3 Layer','502',549,72]], { f: ['Honeycomb textured body', 'Shoulder strap', 'Stainless steel containers'] }),
  P('tiffin-box', 'Lunch Time Tiffin Box', D.tiffin, [['4 Layer','503',749,70],['3 Layer','504',599,80]], { f: ['Carry handle + strap', 'Stainless steel containers'] }),
  P('tiffin-box', 'Big Bite Tiffin Box', D.tiffin, [['3 Layer','509',549,144],['2 Layer','510',449,192]], { f: ['Clear lids', 'Shoulder strap'] }),
  P('tiffin-box', 'Mario Tiffin Box', D.tiffin, [['3 Layer','514',499,144],['2 Layer','515',399,192]], { f: ['2 & 3 partition', 'Carry handle'] }),
  P('tiffin-box', 'Lunch Square Tiffin Box', D.tiffin, [['2 Layer','517',449,175],['1 Layer','518',299,216]], { f: ['Square shape', 'Side clip locks', 'Mini sauce container'] }),
  P('tiffin-box', 'Jio Tiffin', D.tiffin, [[ml(300),'519',199,288]], { f: ['Round compact box', 'Clear lid'] }),
  P('tiffin-box', 'Oreo Tiffin Box', D.tiffin, [['3 Layer','520',549,200],['2 Layer','521',449,160]], { f: ['Carry handle + strap', 'Spoon included (2 layer)'] }),

  /* ---------------- LUNCH BOX ---------------- */
  P('lunch-box', 'Yummy Steel Lunch Box', D.lunchSS, [[ml(1100),'601',449,96],[ml(800),'602',379,96]], { f: ['Stainless steel inside', 'Locking lid', 'Small container'] }),
  P('lunch-box', 'Meal Mate Lunch Box', D.lunch, [['3 Compartment','604',499,96],['2 Compartment','605',429,96]], { f: ['Stainless steel compartments', 'Locking clips'] }),
  P('lunch-box', 'Retro Lunch Box', D.lunchSS, [['Standard','606',399,96]], { f: ['Spoon & fork in lid', 'Small container'] }),
  P('lunch-box', 'Vega Lunch Box', D.lunchSS, [[ml(1200),'607',449,96],[ml(1000),'608',399,96]], { f: ['Stainless steel inside', 'Spoon + small container'] }),
  P('lunch-box', 'Foody Lunch Box', '3-compartment lunch box, ideal for carrying food. ' + D.lunch, [['3 Compartment','609',299,144]]),
  P('lunch-box', 'Pro Max Lunch Box', D.lunch, [[ml(1200),'610',329,144],[ml(800),'611',269,192]], { f: ['Clear body', 'Spoon & fork', 'Small container'] }),
  P('lunch-box', 'Carry Fresh Lunch Box', '3-compartment glass lunch box, ideal for carrying food. ' + D.lunch, [['3 Compartment','612',349,144]], { f: ['Glass body', 'Clear locking lid', 'Spoon & fork'] }),
  P('lunch-box', 'Welly Lunch Box', D.lunch, [['Standard','613',329,144]], { f: ['Cutlery in lid', 'Extra small box'] }),
  P('lunch-box', 'Jemmy Lunch Box', D.lunch, [['3 Compartment','614',349,144]], { f: ['3-compartment tray', 'Locking clips'] }),
  P('lunch-box', 'Smiley Lunch Box', D.bottle, [[ml(800),'615',249,192]], { f: ['2 compartments', 'Fork included'] }),
  P('lunch-box', 'Apolo Lunch Box', D.bottle, [[ml(1100),'616',299,180]], { n: 1, f: ['Kids print lid', 'Small container', 'Spoon & fork'] }),
  P('lunch-box', 'Unique Lunch Box', D.bottle, [[ml(1000),'617',329,144]], { n: 1, f: ['Carry handle', 'Multi-compartment', 'Spork included'] }),
  P('lunch-box', 'Zepto Lunch Box', D.bottle, [[ml(1000),'618',319,144]], { n: 1, f: ['3 compartments', 'Mini containers', 'Spork included'] }),
  P('lunch-box', 'Super Lunch Box', D.bottle, [[ml(1100),'619',349,180]], { n: 1, f: ['Cute character design', '3 compartments', 'Cutlery included'] }),
  P('lunch-box', 'Bento Buddy Lunch Box', D.bottle, [[ml(1200),'620',319,180]], { n: 1, f: ['Locking handle clips', 'Steam vent'] }),
  P('lunch-box', 'Fresh Bite Lunch Box', D.bottle, [[ml(800),'621',279,192]], { n: 1, f: ['Clear dome lid', 'Spork included'] }),

  /* ---------------- MUG ---------------- */
  P('mug', 'Mug Inside S.S', 'Stylish and durable stainless steel mug. This plastic coffee mug with a lid helps you carry your beverage anytime, anywhere.', [[ml(400) + ' big coffee mug','702',199,288]], { f: ['Stainless steel inner', 'Lid included'] }),

  /* ---------------- SERVING TRAY ---------------- */
  P('serving-tray', 'Celebration Serving Tray', D.tray, [['Set of 3 (40x25, 34x21, 26x16 cm)','703',599,72]]),
  P('serving-tray', 'Welcome Serving Tray', D.tray, [['Set of 3 (40x25, 34x21, 26x16 cm)','704',599,90]], { f: ['Floral print'] }),
  P('serving-tray', 'Festival Serving Tray', D.tray, [['Set of 3 (40x25, 34x21, 26x16 cm)','705',549,72]]),

  /* ---------------- CONTAINER ---------------- */
  P('container', 'Modular Airtight Container', 'Airtight kitchen storage containers. The lids with silicone gasket keep food fresh, and the top flips open easily.', [[ml(1400),'707',299,96],[ml(700),'708',199,144],[ml(450),'709',149,432]], { f: ['Silicone gasket', 'Flip-open top', 'Stackable'] }),
  P('container', 'Platinum Jar Set', D.bottle, [['4 pcs jar set + tray','717',549,108],['2 pcs jar set + tray','318',349,144]], { f: ['Floral print', 'Serving spoons included', 'Tray included'] }),
  P('container', 'Big Daawat Container', D.bottle, [['2 pcs','719',349,120],['1 pc','720',199,240]], { f: ['See-through window', 'Ribbed body'] }),
  P('container', 'Small Daawat Container', D.bottle, [['3 pcs','721',299,100],['2 pcs','722',219,144]], { f: ['See-through window', 'Screw lid'] }),
  P('container', 'Aroma Salt & Pepper Shaker', D.bottle, [['4 pcs','723',199,192],['12 pcs','724',449,96]], { f: ['Sprinkle top', 'See-through window'] }),
  P('container', 'Apple Container', D.bottle, [[ml(400) + ' (3 pcs)','725',299,100]], { f: ['Apple-shaped lid', 'Clear jar'] }),

  /* ---------------- JUG & GLASS ---------------- */
  P('jug-glass', 'Falcon Jug', 'A sleek and durable water jug, perfect for serving beverages at home. Designed with a comfortable grip and easy spout.', [[ml(1800),'712',249,108]]),
  P('jug-glass', 'Qubic Glass Set', 'A sturdy plastic glass that offers a convenient and stylish solution for serving drinks at any occasion. Lightweight and reusable.', [['6 pcs set (approx. 350 ml)','713',249,144]]),

  /* ---------------- PENCIL BOX ---------------- */
  P('pencil-box', 'Smart Pencil Box', D.pencil, [['2 Portion','714',149,288]]),
  P('pencil-box', 'Active Pencil Box', D.pencil, [['2 Portion','715',149,288]]),
  P('pencil-box', 'Genius Pencil Box', D.pencil, [['2 Portion','716',129,190]]),

  /* ---------------- COMBO SET ---------------- */
  P('combo-set', 'Celebration Tiffin & Jug Combo', D.jug, [['3 layer tiffin + 3000 ml jug','902',1499,45]]),
  P('combo-set', 'Swastic Jug & Casserole Combo', D.jug, [['2500 ml casserole + 3000 ml jug','903',1899,36]]),
  P('combo-set', 'Crystal Combo Casserole Set', D.casserole, [['2 pcs: 2500 ml + 1500 ml','905',1599,36]], { n: 1 }),
  P('combo-set', 'Merry Gold Jug & Flask Combo', D.bottle, [['3000 ml jug + 800 ml flask','909',1399,45]]),
  P('combo-set', 'H2O Jug with Glass', D.bottle, [['3000 ml jug + 2 glasses','910',1299,60]], { f: ['"Save Tree" embossed', 'Push tap'] }),
  P('combo-set', 'Doremon Lunch Box with Bottle', D.bottle, [['Lunch box + hydro bottle','911',899,96]], { n: 1 }),
  P('combo-set', 'Twin Combo Casserole Set', D.casserole, [['2 pcs: 1500 ml + 1500 ml','912',1399,36]], { n: 1 }),
  P('combo-set', 'Shagun Casserole & Jug Combo', D.bottle, [['3000 ml jug + 1500 ml casserole','913',1699,54]], { n: 1 })
];

module.exports = { categories, products };
