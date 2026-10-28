const crypto = require('crypto');
const store = require('./store');

const newId = () => 'MB' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();

function markPaid(order, paymentId) {
  if (order.payment.status === 'paid' || order.payment.status === 'advance_paid') return order;
  const full = order.paymentMethod === 'prepaid';
  return store.update(order.id, {
    status: 'confirmed',
    payment: { ...order.payment, status: full ? 'paid' : 'advance_paid', razorpayPaymentId: paymentId, paidAmount: order.amounts.payNow, paidAt: new Date().toISOString() }
  });
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

module.exports = { newId, markPaid, safeEqual, hmac };
