// regression.test.js - the checks that failed before the fixes in LOG.md
// and pass after them. Run with:
//
//   npm test          (node --test test/)
//
// The suite boots the real server (node server.js) on a free port with
// TZ=UTC so the canteen is open, exercises the HTTP API exactly as the
// browser does, and puts backend/data back the way it found it.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEED_FILES = ['menu.json', 'coupons.json'];

let server = null;
let base = '';

/* ------------------------------------------------------------ helpers */

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function request(p, { method = 'GET', body = null, headers = {} } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (e) {
    payload = null;
  }
  return { status: res.status, body: payload };
}

const get = (p) => request(p);
const post = (p, body, headers = {}) => request(p, { method: 'POST', body, headers });
const patch = (p, body) => request(p, { method: 'PATCH', body });

/** The menu as it is right now (decorated, like the browser sees it). */
async function menu() {
  const { body } = await get('/api/menu?limit=48');
  return body.dishes;
}

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { body } = await get('/api/health');
      if (body && body.status === 'ok') return body;
    } catch (e) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}

/**
 * A cart worth at least `amount` rupees, built from dishes that are
 * orderable right now and have enough stock. Returns null if the menu
 * cannot reach the amount (it always can with the seed data).
 */
function cartWorthAt(dishes, amount) {
  const items = [];
  let total = 0;
  for (const d of dishes.filter((x) => x.orderable && x.stock > 0).sort((a, b) => b.stock - a.stock)) {
    if (total >= amount) break;
    const qty = Math.min(d.stock, 10, Math.ceil((amount - total) / d.price));
    if (qty < 1) continue;
    items.push({ dishId: d.id, qty });
    total += d.price * qty;
  }
  return total >= amount ? { items, total } : null;
}

const stockOf = (dishes, id) => dishes.find((d) => d.id === id).stock;

/* ------------------------------------------------------------- set up */

before(async () => {
  SEED_FILES.forEach((f) => {
    const p = path.join(DATA_DIR, f);
    fs.copyFileSync(p, `${p}.testbak`);
  });

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;

  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TZ: 'UTC', PORT: String(port), LATENCY_MS: '0', AUTO_COOK: 'false' },
    stdio: 'ignore',
  });

  const health = await waitForServer();
  assert.equal(health.open, true, 'test server must be open (it runs with TZ=UTC)');
});

after(() => {
  if (server) server.kill();
  SEED_FILES.forEach((f) => {
    const p = path.join(DATA_DIR, f);
    if (fs.existsSync(`${p}.testbak`)) {
      fs.copyFileSync(`${p}.testbak`, p);
      fs.rmSync(`${p}.testbak`);
    }
  });
});

/* ------------------------------------------------------------- tests */

test('CC-10: price-asc is cheapest first, price-desc dearest first', async () => {
  const asc = (await get('/api/menu?sort=price-asc&limit=48')).body.dishes.map((d) => d.price);
  const desc = (await get('/api/menu?sort=price-desc&limit=48')).body.dishes.map((d) => d.price);

  for (let i = 1; i < asc.length; i++) {
    assert.ok(asc[i] >= asc[i - 1], `price-asc out of order at ${i}: ${asc[i - 1]} then ${asc[i]}`);
  }
  for (let i = 1; i < desc.length; i++) {
    assert.ok(desc[i] <= desc[i - 1], `price-desc out of order at ${i}: ${desc[i - 1]} then ${desc[i]}`);
  }
});

test('CC-09: the menu comes back one page at a time', async () => {
  const page1 = (await get('/api/menu?limit=5&page=1')).body;
  const page2 = (await get('/api/menu?limit=5&page=2')).body;

  assert.equal(page1.dishes.length, 5, 'page 1 should hold 5 dishes, not the whole menu');
  assert.equal(page2.dishes.length, 5);
  assert.ok(page1.hasMore, 'there are more pages after the first');

  const overlap = page1.dishes.filter((d) => page2.dishes.some((e) => e.id === d.id));
  assert.equal(overlap.length, 0, 'page 2 must not repeat page 1');
});

test('CC-08: an expired coupon is rejected with a reason', async () => {
  const dishes = await menu();
  const cart = cartWorthAt(dishes, 100);
  assert.ok(cart, 'seed menu should reach Rs. 100');

  const quote = await post('/api/cart/quote', { items: cart.items, couponCode: 'FRESHERS24' });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.couponDiscount, 0, 'expired coupon must not discount');
  assert.match(quote.body.couponError || '', /expired/i);

  const order = await post('/api/orders', { items: cart.items, couponCode: 'FRESHERS24' });
  assert.equal(order.status, 400, 'an expired coupon must not survive placing the order');
});

test('CC-08 sanity check: a valid coupon still works', async () => {
  const dishes = await menu();
  const cart = cartWorthAt(dishes, 100);
  const quote = await post('/api/cart/quote', { items: cart.items, couponCode: 'BYTE10' });
  assert.equal(quote.body.couponCode, 'BYTE10');
  assert.ok(quote.body.couponDiscount > 0, 'BYTE10 should still discount a qualifying order');
});

test('CC-06: you cannot order more than is in stock', async () => {
  const dishes = await menu();
  const low = dishes.find((d) => d.orderable && d.stock === 2);
  assert.ok(low, 'seed menu should have an orderable dish with stock 2');

  const before = stockOf(await menu(), low.id);
  const order = await post('/api/orders', { items: [{ dishId: low.id, qty: 5 }] });

  assert.equal(order.status, 400, 'ordering 5 of a 2-left dish must be refused');
  const after = stockOf(await menu(), low.id);
  assert.equal(after, before, 'a refused order must not touch stock');
  assert.ok(after >= 0, 'stock must never go negative');

  const good = await post('/api/orders', { items: [{ dishId: low.id, qty: 2 }] });
  assert.equal(good.status, 201, 'ordering exactly the stock should still work');
});

test('CC-07: cancelling an order puts its stock back', async () => {
  const pick = async () => (await menu()).find((d) => d.orderable && d.stock >= 3);
  const dish = await pick();
  assert.ok(dish, 'seed menu should have an orderable dish with stock >= 3');

  const before = stockOf(await menu(), dish.id);

  const order = await post('/api/orders', { items: [{ dishId: dish.id, qty: 1 }] });
  assert.equal(order.status, 201);
  const during = stockOf(await menu(), dish.id);
  assert.equal(during, before - 1, 'placing an order should reserve the stock');

  const cancel = await patch(`/api/orders/${order.body.token}/status`, { status: 'cancelled' });
  assert.equal(cancel.status, 200);

  const restored = stockOf(await menu(), dish.id);
  assert.equal(restored, before, `cancelling must restore stock (was ${during}, ended ${restored})`);
});

test('extra: a member can list their own orders', async () => {
  const dishes = await menu();
  const dish = dishes.find((d) => d.orderable && d.stock > 0);
  const member = 'regression-device';

  const order = await post('/api/orders', { items: [{ dishId: dish.id, qty: 1 }] }, { 'X-Member-Id': member });
  assert.equal(order.status, 201);
  assert.equal(order.body.memberId, member);

  const list = await get(`/api/orders?memberId=${member}`);
  assert.ok(
    list.body.orders.some((o) => o.token === order.body.token),
    'the member filter should return the orders that member placed'
  );

  const stranger = await get('/api/orders?memberId=someone-else');
  assert.ok(
    !stranger.body.orders.some((o) => o.token === order.body.token),
    "one member's orders must not leak into another's list"
  );
});

test('extra: coupon uses are counted once per order and given back on cancel', async () => {
  const dishes = await menu();
  const cart = cartWorthAt(dishes, 100);
  assert.ok(cart, 'seed menu should reach Rs. 100 for a coupon order');

  // the store writes synchronously before it answers, so reading the
  // seed file is a fair oracle for what the server just saved
  const uses = () => {
    const coupons = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'coupons.json'), 'utf8'));
    return coupons.find((c) => c.code === 'BYTE10').usesLeft;
  };

  const before = await uses();

  // a fresh key per run: orders.json survives between runs, and the
  // server would replay an old order with the same key instead of
  // placing a new one
  const idemKey = `regression-${randomUUID()}`;

  const order = await post(
    '/api/orders',
    { items: cart.items, couponCode: 'BYTE10' },
    { 'Idempotency-Key': idemKey }
  );
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.ok(order.body.couponDiscount > 0);
  assert.equal(await uses(), before - 1, 'placing a coupon order should spend one use');

  // the same idempotency key must not spend a second use
  const replay = await post(
    '/api/orders',
    { items: cart.items, couponCode: 'BYTE10' },
    { 'Idempotency-Key': idemKey }
  );
  assert.equal(replay.body.token, order.body.token, 'a replayed key returns the same order');
  assert.equal(await uses(), before - 1, 'a replayed order must not spend another use');

  await patch(`/api/orders/${order.body.token}/status`, { status: 'cancelled' });
  assert.equal(await uses(), before, 'cancelling should give the use back, not mint a new one');
});
