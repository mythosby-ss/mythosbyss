// Input quality checks for checkout and login: blocks obviously fake names, addresses, pincodes and phone numbers.
const settings = require('./settings');

const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];

// Whole-field junk values, and words that should never appear in a real address
const JUNK_VALUES = new Set(['na', 'n/a', 'nil', 'none', 'null', 'undefined', 'abc', 'abcd', 'xyz', 'xxx', 'hello', 'hi', 'ok', 'no', 'nothing', 'address', 'home', 'house', 'landmark', 'near', 'city', 'name', 'same']);
const JUNK_WORDS = /\b(test|testing|tester|asdf\w*|qwert\w*|zxcv\w*|dummy|fake|sample|lorem|ipsum|blah)\b/i;

/** true if the text looks like keyboard mashing / placeholder input */
function looksFake(value) {
  const t = String(value || '').trim().toLowerCase();
  const compact = t.replace(/[^\p{L}\p{N}]/gu, '');
  if (!compact) return true;
  if (JUNK_VALUES.has(t) || JUNK_VALUES.has(compact)) return true;
  if (JUNK_WORDS.test(t)) return true;
  if (compact.length >= 4 && /^(.)\1+$/.test(compact)) return true; // aaaa, 1111
  if (/(.)\1{4,}/.test(compact)) return true;                       // 5+ identical characters in a row
  if (/(.{2,3})\1{3,}/.test(compact)) return true;                   // ababab..., abcabcabcabc
  return false;
}

const PHONE = /^[6-9]\d{9}$/;
/** 10-digit Indian mobile, not all-same digits or an obvious sequence */
function isValidPhone(p) {
  const s = String(p || '');
  if (!PHONE.test(s)) return false;
  if (/^(\d)\1{9}$/.test(s)) return false;                 // 9999999999
  if (/(\d)\1{6,}/.test(s)) return false;                  // 7+ identical digits in a row
  if (['9876543210', '6789012345', '7890123456', '8901234567', '9012345678'].includes(s)) return false;
  return true;
}

function isValidPincode(p) {
  const s = String(p || '');
  return /^[1-9]\d{5}$/.test(s) && !/^(\d)\1{5}$/.test(s) && s !== '123456';
}

/** Checkout address form. Returns { field: message } for every problem (empty object = valid). */
function address(b) {
  const e = {}; const s = (v) => String(v || '').trim();
  const name = s(b.name);
  if (name.length < 3 || !/^\p{L}[\p{L}\p{M} .'-]*$/u.test(name) || looksFake(name)) e.name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s(b.email)) || JUNK_WORDS.test(s(b.email))) e.email = 'Enter a valid email address.';
  if (!s(b.house) || s(b.house).length > 60 || looksFake(b.house)) e.house = 'Enter your house / flat number and building.';
  const area = s(b.line1);
  if (area.length < 8 || !/\p{L}{3,}/u.test(area) || looksFake(area)) e.line1 = 'Enter your full street, area or locality (at least 8 characters).';
  const lm = s(b.landmark);
  if (settings.on('address_require_landmark') && (lm.length < 4 || !/\p{L}{3,}/u.test(lm) || looksFake(lm))) e.landmark = 'Enter a nearby landmark so the courier can find you.';
  else if (lm && looksFake(lm)) e.landmark = 'Enter a real landmark.';
  const city = s(b.city);
  if (city.length < 3 || !/^\p{L}[\p{L}\p{M} .()-]*$/u.test(city) || looksFake(city)) e.city = 'Enter your city.';
  if (!STATES.includes(s(b.state))) e.state = 'Select your state.';
  if (!isValidPincode(s(b.pincode))) e.pincode = 'Enter a valid 6-digit pincode.';
  return e;
}

module.exports = { STATES, looksFake, isValidPhone, isValidPincode, address };
