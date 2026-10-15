// reproduce.js - hands-on reproduction of the backend complaints.
// Start the server first (TZ=UTC so the canteen is open), then:
//
//   node scripts/reproduce.js
//
// It prints what actually happens next to what the complaint says should
// happen. Nothing here fixes anything; it only observes. (The automatic
// checks live next door in test/regression.test.js - run npm test.)

const BASE = process.env.BASE || 'http://localhost:3000';

async function call(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const res = await fetch(BASE + path, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return { status: res.status, body };
}

const get = (p) => call(p);
const post = (p, body, headers = {}) =>
  call(p, { method: 'POST', body: JSON.stringify(body), headers });
const patch = (p, body) =>
  call(p, { method: 'PATCH', body: JSON.stringify(body) });

function line(label, value) {
  console.log(`  ${label.padEnd(34)} ${value}`);
}

async function main() {
  const health = await get('/api/health');
  console.log(`server open: ${health.body.open} (slot ${health.body.slot})`);
  if (!health.body.open) {
    console.log('canteen closed - restart the server with TZ=UTC');
    process.exit(1);
  }

  /* ------------------------------------------------ CC-10 sorting */
  console.log('\nCC-10 "price: low to high" gives the expensive dishes first');
  for (const sort of ['price-asc', 'price-desc']) {
    const { body } = await get(`/api/menu?sort=${sort}&limit=48`);
    const prices = body.dishes.slice(0, 6).map((d) => d.price);
    const sorted = [...prices].sort((a, b) => (sort === 'price-asc' ? a - b : b - a));
    const ok = JSON.stringify(prices) === JSON.stringify(sorted);
    line(`${sort} first prices`, `${prices.join(', ')}  -> ${ok ? 'OK' : 'BACKWARDS'}`);
  }

  /* ------------------------------------------------ CC-09 paging */
  console.log('\nCC-09 "load a few dishes at a time" - server returns everything');
  {
    const { body } = await get('/api/menu?limit=5&page=1');
    line('requested limit', 5);
    line('dishes returned', body.dishes.length);
    line('total / pages / hasMore', `${body.total} / ${body.pages} / ${body.hasMore}`);
    line(
      'verdict',
      body.dishes.length === 5 ? 'OK' : `BUG - ${body.dishes.length} dishes for one page`
    );
  }

  /* ------------------------------------------------ CC-08 coupon */
  console.log('\nCC-08 last year\'s expired coupon FRESHERS24 still discounts');
  {
    const { body } = await get('/api/menu?limit=48');
    const dish = body.dishes.find((d) => d.orderable && d.price >= 30);
    const quote = await post('/api/cart/quote', {
      items: [{ dishId: dish.id, qty: 4 }],
      couponCode: 'FRESHERS24',
    });
    line('dish used', `${dish.name} x4 = Rs. ${quote.body.subtotal}`);
    line('couponDiscount / couponError', `${quote.body.couponDiscount} / ${quote.body.couponError}`);
    line('verdict', quote.body.couponDiscount > 0 ? 'BUG - expired coupon accepted' : 'OK');
  }

  /* -------------------------------------------------- CC-06 stock */
  console.log('\nCC-06 "only 2 left but it let me order 5"');
  let lowStockDish = null;
  {
    const { body } = await get('/api/menu?limit=48');
    lowStockDish = body.dishes.find((d) => d.stock === 2 && d.orderable);
    line('dish', `${lowStockDish.name} (id ${lowStockDish.id}), stock ${lowStockDish.stock}`);
    const order = await post('/api/orders', {
      items: [{ dishId: lowStockDish.id, qty: 5 }],
    });
    line('POST /api/orders qty 5', `status ${order.status} (${order.body.error || 'created'})`);
    const after = await get(`/api/menu/${lowStockDish.id}`);
    line('stock after the order', after.body.stock);
    line(
      'verdict',
      order.status === 201 ? `BUG - order of 5 accepted, stock now ${after.body.stock}` : 'OK'
    );
    var orderToken = order.body.token;
  }

  /* ------------------------------------------------ CC-07 cancel */
  console.log('\nCC-07 cancelling takes stock away a second time');
  {
    const { body } = await get('/api/menu?limit=48');
    const dish = body.dishes.find((d) => d.orderable && d.id !== lowStockDish.id && d.stock > 3);
    const before = dish.stock;
    const order = await post('/api/orders', { items: [{ dishId: dish.id, qty: 1 }] });
    const mid = (await get(`/api/menu/${dish.id}`)).body.stock;
    const cancel = await patch(`/api/orders/${order.body.token}/status`, { status: 'cancelled' });
    const end = (await get(`/api/menu/${dish.id}`)).body.stock;
    line('dish', `${dish.name} (id ${dish.id})`);
    line('stock before / after order', `${before} / ${mid}`);
    line('stock after cancel', `${end}`);
    line(
      'verdict',
      cancel.status === 200 && end === before
        ? 'OK - stock restored'
        : `BUG - cancel went ${mid} -> ${end} instead of back to ${before}`
    );
  }

  if (orderToken) console.log(`\n(CC-06 order left as ${orderToken}; reset with: git checkout -- backend/data/)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
