// Sidebar structure (mirrors the reference design). Icons are simple inline SVG paths (24x24, stroke).
const I = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l2-3h12M16 14h2',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
  megaphone: 'M3 11v3l14 5V6zM17 9a3 3 0 0 1 0 6M7 16l1 5h3l-1-4',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  star: 'M12 2l3 6.5 7 .9-5.2 4.8 1.4 7L12 17.8 5.8 21.2l1.4-7L2 9.4l7-.9z',
  plug: 'M7 7H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3M17 7h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3M7 7v10M17 7v10M7 7c0-2 1.5-4 5-4s5 2 5 4M7 17c0 2 1.5 4 5 4s5-2 5-4'
};
module.exports = [
  { label: 'Home', href: '/admin', icon: I.home },
  { label: 'Analytics', icon: I.chart, children: [['Profit & RTO', '/admin/profit'], ['Dashboard', '/admin/analytics'], ['Monthly Report', '/admin/monthly-report'], ['Reports', '/admin/reports']] },
  { label: 'Orders', icon: I.box, children: [['Process orders', '/admin/orders'], ['All orders', '/admin/orders?tab=all']] },
  { label: 'Finance', icon: I.wallet, children: [['Remittance', '/admin/finance'], ['Order finance', '/admin/finance/orders'], ['Refunds', '/admin/finance/refunds']] },
  { label: 'Products', icon: I.grid, children: [['Catalogue', '/admin/catalogue'], ['Create product', '/admin/catalogue/new'], ['Drive images', '/admin/catalogue/drive'], ['Inventory', '/admin/inventory']] },
  { label: 'Customers', icon: I.users, children: [['Purchasing customers', '/admin/customers']] },
  { label: 'Offers and Coupons', icon: I.tag, children: [['Coupons', '/admin/coupons'], ['Bundles, add-ons & offers', '/admin/offers']] },
  { label: 'Marketing', icon: I.megaphone, children: [['Performance marketing', '/admin/marketing/performance'], ['Digital marketing', '/admin/marketing/digital'], ['SEO optimization', '/admin/marketing/seo']] },
  { label: 'Website', icon: I.globe, children: [['UGC testimonials', '/admin/website/testimonials'], ['Customer reviews', '/admin/website/reviews'], ['Policy pages & support', '/admin/website/pages']] },
  { label: 'Communication', href: '/admin/communication', icon: I.chat },
  { label: 'Plugins', href: '/admin/plugins', icon: I.plug },
  { label: 'Settings', icon: I.gear, children: [['Store & charges', '/admin/settings'], ['COD & RTO rules', '/admin/settings/cod'], ['Shipping & NDR', '/admin/settings/shipping'], ['Billing & invoice', '/admin/settings/billing'], ['Marketing & tracking', '/admin/settings/marketing'], ['Shipping label', '/admin/settings/label'], ['Ops & owner emails', '/admin/settings/ops']] }
];
