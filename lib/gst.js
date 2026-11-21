// GST state codes (first two digits of a GSTIN) and invoice tax maths.
const GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh'
};
const r2 = (n) => Math.round(n * 100) / 100;
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
/** Prices are GST-inclusive. Returns lines + tax split for an order. */
function invoice(o, { rate, homeState }) {
  const intra = norm(o.state) && norm(o.state) === norm(homeState);
  const line = (desc, sku, qty, gross) => { const taxable = r2(gross / (1 + rate / 100)); return { desc, sku, qty, gross: r2(gross), taxable, tax: r2(gross - taxable) }; };
  const lines = o.items.map((i) => line(`${i.product_name}${i.variant_label ? ' (' + i.variant_label + ')' : ''}`, i.sku, i.qty, i.unit_price * i.qty));
  if (o.shipping_fee > 0) lines.push(line('Shipping charges', '', 1, o.shipping_fee));
  if (o.cod_fee > 0) lines.push(line('COD charges', '', 1, o.cod_fee));
  if (o.discount > 0) lines.push(line(`Discount${o.coupon_code ? ' (' + o.coupon_code + ')' : ''}`, '', 1, -o.discount));
  const taxable = r2(lines.reduce((s, l) => s + l.taxable, 0)); const tax = r2(o.total - taxable);
  return { lines, rate, intra, taxable, tax, cgst: intra ? r2(tax / 2) : 0, sgst: intra ? r2(tax - r2(tax / 2)) : 0, igst: intra ? 0 : tax, total: r2(o.total) };
}
module.exports = { GST_STATES, invoice };
