// WP-ACADEMY-2 end-to-end test against a throwaway database.
// Boots the real server on a temp DB plus a local platform-sync stub, then
// walks: owner signup (sync shop_created), advisor join (sync member_joined),
// sync failure -> queue -> boot retry, KPI scorecards (advisor + shop math,
// history, rollups, edit lock, weekday nudge), comprehension checks (fail,
// gate, pass, retro points, retake), reading heartbeats + owner insights +
// advisor invisibility, watermark copyright, poster orders, and a double-boot
// idempotency check. Run: node scripts/test-wp-academy2.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const TEST_DIR = '/tmp/hab-wp-academy2-test';
const PORT = 4188;
const STUB_PORT = 4189;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = 'heath@healthyautobusiness.com';
const ADMIN_PASS = 'HabAdmin2026!';
const SECRET = 'test-sync-secret';

let passed = 0, failed = 0;
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); }
};

function client() {
  const jar = {};
  return async function req(method, path, body) {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload;
    if (body) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(body).toString();
    }
    const res = await fetch(`${BASE}${path}`, { method, headers, body: payload, redirect: 'manual' });
    for (const sc of res.headers.getSetCookie?.() || []) {
      const [pair] = sc.split(';');
      const eq = pair.indexOf('=');
      jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), text };
  };
}

// ===== Platform sync stub =====
const stubEvents = [];
let stubUp = true;
const stub = http.createServer((req, res) => {
  if (!stubUp) { req.socket.destroy(); return; }
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    stubEvents.push({
      path: req.url,
      secret: req.headers['x-hab-sync-secret'],
      payload: (() => { try { return JSON.parse(body); } catch { return null; } })(),
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise(r => stub.listen(STUB_PORT, r));

function startServer() {
  const child = spawn('node', ['server.js'], {
    env: {
      ...process.env,
      DATA_DIR: TEST_DIR, DB_PATH: `${TEST_DIR}/academy.db`, PORT: String(PORT), NODE_ENV: '',
      PLATFORM_SYNC_URL: `http://localhost:${STUB_PORT}`,
      PLATFORM_SYNC_SECRET: SECRET,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  return { child, getLog: () => log };
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/login`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('server did not come up');
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stopServer = (child) => new Promise(r => { child.on('exit', r); child.kill(); });

fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DIR, { recursive: true });

let { child } = startServer();
await waitUp();
const db = () => new Database(`${TEST_DIR}/academy.db`);
const iso = (d) => d.toISOString().slice(0, 10);
const today = iso(new Date());

try {
  // ===== 1. Owner signup -> shop_created sync event =====
  console.log('\n1. Owner signup with shop contact fields -> shop_created sync');
  const owner = client();
  let r = await owner('POST', '/signup/owner', {
    name: 'Casey Owner', email: 'casey@a2shop.com', password: 'password123', confirm: 'password123',
    shopName: 'A2 Test Automotive', brandName: 'A2 Brand Group',
    address: '123 Main St, Redding, CA 96001', phone: '(530) 555-0100', website: 'https://a2auto.com',
    tier: 'consulting', term: '12',
  });
  ok(r.status === 302 && r.location === '/signup/agreement', 'owner form advances to agreement');
  r = await owner('GET', '/signup/agreement');
  ok(r.status === 200, 'agreement renders');
  r = await owner('POST', '/signup/agreement', { agree: 'on', signedName: 'Casey Owner' });
  ok(r.status === 302 && r.location === '/dashboard', 'agreement signed, owner logged in');
  await sleep(800); // let async sync delivery land
  const evShop = stubEvents.find(e => e.payload?.type === 'shop_created');
  ok(!!evShop, 'stub received shop_created');
  ok(evShop?.path === '/api/integrations/academy/events', 'sync POST hits /api/integrations/academy/events');
  ok(evShop?.secret === SECRET, 'X-HAB-SYNC-SECRET header correct');
  const sp = evShop?.payload?.shop || {};
  ok(sp.name === 'A2 Test Automotive' && sp.org === 'A2 Brand Group', 'payload: shop name + org');
  ok(sp.owner_name === 'Casey Owner' && sp.owner_email === 'casey@a2shop.com', 'payload: owner name/email');
  ok(sp.address === '123 Main St, Redding, CA 96001' && sp.phone === '(530) 555-0100', 'payload: address + phone');
  ok(sp.tier === 'consulting' && sp.term_months === 12 && typeof sp.join_code === 'string' && sp.join_code.length === 6, 'payload: tier/term/join_code');
  {
    const d = db();
    const shop = d.prepare(`SELECT * FROM shops WHERE name = 'A2 Test Automotive'`).get();
    ok(shop.address === '123 Main St, Redding, CA 96001' && shop.phone === '(530) 555-0100' && shop.website === 'https://a2auto.com', 'shop row stores address/phone/website');
    d.close();
  }

  const joinCode = sp.join_code;

  // ===== 2. Advisor join -> member_joined sync event =====
  console.log('\n2. Advisor join -> member_joined sync');
  const advisor = client();
  r = await advisor('POST', '/join', {
    code: joinCode, name: 'Alex Advisor', email: 'alex@a2shop.com',
    password: 'password123', confirm: 'password123', role: 'advisor',
  });
  ok(r.status === 302 && r.location === '/dashboard', 'advisor joined and logged in');
  await sleep(800);
  const evMember = stubEvents.find(e => e.payload?.type === 'member_joined');
  ok(!!evMember, 'stub received member_joined');
  ok(evMember?.payload?.shop_name === 'A2 Test Automotive', 'payload: shop_name');
  ok(evMember?.payload?.user?.name === 'Alex Advisor' && evMember?.payload?.user?.email === 'alex@a2shop.com' && evMember?.payload?.user?.role === 'advisor', 'payload: user name/email/role');

  // ===== 3. Sync failure -> queue -> boot retry =====
  console.log('\n3. Sync failure queues, boot retry delivers');
  stubUp = false;
  const advisor2 = client();
  r = await advisor2('POST', '/join', {
    code: joinCode, name: 'Riley Rookie', email: 'riley@a2shop.com',
    password: 'password123', confirm: 'password123', role: 'advisor',
  });
  ok(r.status === 302 && r.location === '/dashboard', 'join succeeds even while sync endpoint is down');
  await sleep(1200);
  {
    const d = db();
    const pend = d.prepare(`SELECT * FROM sync_queue WHERE status = 'pending'`).all();
    ok(pend.length === 1 && pend[0].event_type === 'member_joined' && pend[0].attempts >= 1, 'failed event sits pending in sync_queue with an attempt recorded');
    d.close();
  }
  stubUp = true;
  await stopServer(child);
  ({ child } = startServer());
  await waitUp();
  await sleep(1200);
  {
    const d = db();
    const pend = d.prepare(`SELECT COUNT(*) c FROM sync_queue WHERE status = 'pending'`).get().c;
    const sent = d.prepare(`SELECT COUNT(*) c FROM sync_queue WHERE status = 'sent'`).get().c;
    ok(pend === 0 && sent === 3, `boot retry drained the queue (sent=${sent}, pending=${pend})`);
    d.close();
  }
  ok(stubEvents.filter(e => e.payload?.type === 'member_joined' && e.payload?.user?.email === 'riley@a2shop.com').length === 1, 'queued event delivered exactly once after reboot');

  // ===== 4. KPI scorecards =====
  console.log('\n4. KPI scorecards: advisor entry, shop math, rollups, lock');
  const adv = client();
  r = await adv('POST', '/login', { email: 'alex@a2shop.com', password: 'password123' });
  ok(r.status === 302, 'advisor logs back in');
  r = await adv('POST', '/scorecard/advisor', { entryDate: today, revenue: '4200', grossProfit: '2520', carCount: '6' });
  ok(r.status === 302 && /message=/.test(r.location), 'advisor scorecard entry saved');
  r = await adv('GET', '/scorecard');
  ok(r.text.includes('$4,200.00') && r.text.includes('$2,520.00'), 'advisor history shows the entry');
  ok(r.text.includes('$700.00'), 'advisor ARO auto-calculated (4200 / 6 = $700.00)');
  ok(!r.text.includes('Shop Numbers'), 'advisor scorecard page has no shop entry form');

  // locked entry (10 days back) rejected for client roles
  const oldDate = iso(new Date(Date.now() - 10 * 86400000));
  r = await adv('POST', '/scorecard/advisor', { entryDate: oldDate, revenue: '100', grossProfit: '50', carCount: '1' });
  ok(r.status === 302 && /error=/.test(r.location) && /lock/i.test(decodeURIComponent(r.location)), 'entries older than 7 days are locked for advisors');

  const ownr = client();
  r = await ownr('POST', '/login', { email: 'casey@a2shop.com', password: 'password123' });
  ok(r.status === 302, 'owner logs in');
  r = await ownr('POST', '/scorecard/shop', {
    entryDate: today, totalRevenue: '12000', grossProfit: '6600', tax: '900', costOfGoods: '3200', carCount: '15',
  });
  ok(r.status === 302 && /message=/.test(r.location), 'shop scorecard entry saved');
  r = await ownr('GET', '/scorecard');
  ok(r.text.includes('$800.00'), 'shop ARO auto-calculated (12000 / 15 = $800.00)');
  ok(r.text.includes('55.0%'), 'shop GP% auto-calculated (6600 / 12000 = 55.0%)');
  ok(r.text.includes('Alex Advisor') && r.text.includes('$4,200.00'), 'owner rollup shows the advisor entry');

  // same-day edit allowed
  r = await ownr('POST', '/scorecard/shop', { entryDate: today, totalRevenue: '12500', grossProfit: '6600', tax: '900', costOfGoods: '3200', carCount: '15' });
  ok(r.status === 302 && /message=/.test(r.location), 'same-day shop entry is editable (upsert)');
  {
    const d = db();
    const rows = d.prepare(`SELECT * FROM shop_scorecards`).all();
    ok(rows.length === 1 && rows[0].total_revenue === 12500, 'edit updated in place (no duplicate row)');
    d.close();
  }

  // weekday nudge (only assert on weekdays)
  const dow = new Date().getDay();
  if (dow >= 1 && dow <= 5) {
    r = await adv('GET', '/dashboard');
    ok(/scorecard for \d{4}-\d{2}-\d{2} is missing/.test(r.text) && r.text.includes('coaching tactic'), 'advisor dashboard nudges for the missing previous-business-day entry');
  } else {
    console.log('  SKIP  weekday nudge (today is a weekend)');
  }

  // hab_admin org rollup
  const admin = client();
  r = await admin('POST', '/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
  ok(r.status === 302, 'hab_admin logs in');
  r = await admin('GET', '/admin/scorecards');
  // (the same-day edit above bumped revenue to 12500, so ARO = 12500/15 = 833.33)
  ok(r.status === 200 && r.text.includes('A2 Test Automotive') && r.text.includes('$833.33'), 'hab_admin org rollup shows shop ARO');

  // ===== 5. Comprehension checks =====
  console.log('\n5. Comprehension checks gate the module points');
  const checks = JSON.parse(fs.readFileSync('content/curriculum/checks.json', 'utf8'));
  const m1 = checks.modules.M1;
  const rightAnswers = Object.fromEntries(m1.questions.map((q, i) => [`q${i}`, String(q.answer)]));
  const wrongAnswers = Object.fromEntries(m1.questions.map((q, i) => [`q${i}`, String((q.answer + 1) % q.options.length)]));

  // mark a section complete before passing -> progress yes, points 0, message shown
  r = await adv('GET', '/curriculum/m1');
  const secMatch = r.text.match(/sections\/([a-z0-9-]+)\/toggle/);
  ok(!!secMatch, 'chapter exposes section toggle');
  const sec1 = secMatch[1];
  ok(r.text.includes('Comprehension check: not passed yet'), 'chapter shows the unpassed-check banner');
  r = await adv('POST', `/curriculum/m1/sections/${sec1}/toggle`, {});
  ok(r.status === 302 && /notice=check/.test(r.location), 'completing without a pass redirects with the check notice');
  r = await adv('GET', '/curriculum/m1?notice=check');
  ok(r.text.includes('complete the comprehension check to earn your points') || r.text.includes('Complete the comprehension check to earn your points'), 'notice copy shown');
  {
    const d = db();
    const uid = d.prepare(`SELECT id FROM users WHERE email='alex@a2shop.com'`).get().id;
    const prog = d.prepare(`SELECT COUNT(*) c FROM section_progress WHERE user_id=?`).get(uid).c;
    const pts = d.prepare(`SELECT COALESCE(SUM(points),0) p FROM points_ledger WHERE user_id=? AND reason='section'`).get(uid).p;
    ok(prog === 1 && pts === 0, 'progress recorded, 0 points awarded before pass');
    d.close();
  }

  // quiz page leaks no answers
  r = await adv('GET', '/curriculum/m1/check');
  ok(r.status === 200 && r.text.includes('Question 1 of'), 'check page renders questions');
  ok(!r.text.includes('"answer"'), 'answers are not sent to the browser');

  // fail attempt
  r = await adv('POST', '/curriculum/m1/check', wrongAnswers);
  ok(r.status === 200 && r.text.includes('Not yet') && r.text.includes('0/5'), 'failing attempt shows score and retake copy');
  {
    const d = db();
    const uid = d.prepare(`SELECT id FROM users WHERE email='alex@a2shop.com'`).get().id;
    const pts = d.prepare(`SELECT COALESCE(SUM(points),0) p FROM points_ledger WHERE user_id=? AND reason='section'`).get(uid).p;
    ok(pts === 0, 'failed attempt awards 0 points');
    d.close();
  }

  // pass attempt (retake) -> retroactive grant for the completed section
  r = await adv('POST', '/curriculum/m1/check', rightAnswers);
  ok(r.status === 200 && r.text.includes('Passed: 5/5'), 'retake with correct answers passes');
  {
    const d = db();
    const uid = d.prepare(`SELECT id FROM users WHERE email='alex@a2shop.com'`).get().id;
    const pts = d.prepare(`SELECT COALESCE(SUM(points),0) p FROM points_ledger WHERE user_id=? AND reason='section'`).get(uid).p;
    ok(pts === 10, 'pass retroactively grants the completed section 10 points');
    const attempts = d.prepare(`SELECT COUNT(*) c FROM check_attempts WHERE user_id=?`).get(uid).c;
    ok(attempts === 2, 'both attempts recorded');
    d.close();
  }

  // post-pass completion awards immediately
  r = await adv('GET', '/curriculum/m1');
  const sec2 = [...r.text.matchAll(/sections\/([a-z0-9-]+)\/toggle/g)].map(m => m[1]).find(s => s !== sec1);
  r = await adv('POST', `/curriculum/m1/sections/${sec2}/toggle`, {});
  ok(r.status === 302 && !/notice=check/.test(r.location), 'post-pass completion needs no notice');
  {
    const d = db();
    const uid = d.prepare(`SELECT id FROM users WHERE email='alex@a2shop.com'`).get().id;
    const pts = d.prepare(`SELECT COALESCE(SUM(points),0) p FROM points_ledger WHERE user_id=? AND reason='section'`).get(uid).p;
    ok(pts === 20, 'post-pass section completion awards 10 points immediately');
    d.close();
  }

  // ===== 6. Reading heartbeats + owner insights + invisibility =====
  console.log('\n6. Heartbeats record; owner sees insights; advisor/coach UI is clean');
  for (let i = 0; i < 3; i++) {
    const res = await adv('POST', '/api/hb', { k: 'm1' });
    ok(res.status === 204, `heartbeat ${i + 1} accepted (204)`);
  }
  await adv('POST', '/api/hb', { k: 'book:advisor-book' });
  {
    const d = db();
    const uid = d.prepare(`SELECT id FROM users WHERE email='alex@a2shop.com'`).get().id;
    const rows = d.prepare(`SELECT content_key, seconds FROM content_time WHERE user_id=? ORDER BY content_key`).all(uid);
    ok(rows.length === 2 && rows.find(x => x.content_key === 'm1')?.seconds === 90 && rows.find(x => x.content_key === 'book:advisor-book')?.seconds === 30, 'beats accumulate per content key (3x30s + 1x30s)');
    d.close();
  }
  r = await ownr('GET', '/insights');
  ok(r.status === 200 && r.text.includes('actually reading'), 'owner insights page renders with the owner copy');
  ok(r.text.includes('Alex Advisor') && r.text.includes('M1'), 'owner sees per-user, per-module reading time');
  ok(/Last active/i.test(r.text), 'owner sees last-active');

  // coach must have no access and no nav reference
  const coachC = client();
  r = await coachC('POST', '/join', { code: joinCode, name: 'Cameron Coach', email: 'coach@a2shop.com', password: 'password123', confirm: 'password123', role: 'coach' });
  r = await ownr('GET', '/dashboard');
  const pendId = (r.text.match(/\/team\/pending\/(\d+)\/approve/) || [])[1];
  ok(!!pendId, 'coach signup pending on owner dashboard');
  r = await ownr('POST', `/team/pending/${pendId}/approve`, {});
  r = await coachC('POST', '/login', { email: 'coach@a2shop.com', password: 'password123' });
  ok(r.status === 302, 'coach approved and logs in');
  r = await coachC('GET', '/insights');
  ok(r.status === 403, 'coach gets 403 on /insights');

  const dirty = /(engagement|insights|analytics|Team Reading|content_time|heartbeat|time.on.page)/i;
  let clean = true;
  for (const p of ['/dashboard', '/curriculum', '/curriculum/m1', '/curriculum/m1/check', '/library', '/leaderboard', '/scorecard', '/team']) {
    const res = await adv('GET', p);
    if (dirty.test(res.text)) { clean = false; console.log(`        dirty page for advisor: ${p} -> ${res.text.match(dirty)[0]}`); }
  }
  ok(clean, 'advisor-rendered pages carry zero engagement references');
  let coachClean = true;
  for (const p of ['/dashboard', '/curriculum', '/team', '/scorecard']) {
    const res = await coachC('GET', p);
    if (dirty.test(res.text)) { coachClean = false; console.log(`        dirty page for coach: ${p} -> ${res.text.match(dirty)[0]}`); }
  }
  ok(coachClean, 'coach-rendered pages carry zero engagement references');

  // hab_admin all-shops view
  r = await admin('GET', '/insights');
  ok(r.status === 200 && r.text.includes('All Shops') && r.text.includes('A2 Test Automotive'), 'hab_admin sees the all-shops reading view');

  // ===== 7. Watermark copyright =====
  console.log('\n7. Watermark + license footer carry the copyright line');
  const LINE = '© 2026 HAB Enterprises 3 LLC. All rights reserved.';
  r = await adv('GET', '/curriculum/m1');
  ok(r.text.includes(LINE), 'curriculum chapter (advisor) carries the copyright line');
  ok(r.text.includes('hab-watermark'), 'watermark overlay present for advisor');
  r = await adv('GET', '/library/advisor-book');
  ok(r.text.includes(LINE) && r.text.includes('hab-watermark'), 'book delivery carries watermark + copyright');
  r = await admin('GET', '/curriculum/m1');
  ok(!r.text.includes('hab-watermark'), 'hab_admin stays watermark-free');

  // ===== 8. Poster orders =====
  console.log('\n8. Poster orders (invoice pending, price quoted)');
  r = await ownr('GET', '/orders');
  ok(r.text.includes('66-Step Process Poster') && r.text.includes('HAB Wall Poster Set') && r.text.includes('Quoted on order'), 'order form shows the Posters section with quoted pricing');
  r = await ownr('POST', '/orders', {
    'qty_advisor-book': '2', 'qty_poster-66-step': '1', 'qty_poster-wall-set': '3',
    shipName: 'Casey Owner, A2 Test Automotive', shipAddress: '123 Main St, Redding, CA 96001',
  });
  ok(r.status === 302 && /message=/.test(r.location), 'mixed book + poster order records');
  {
    const d = db();
    const order = d.prepare(`SELECT * FROM book_orders ORDER BY id DESC LIMIT 1`).get();
    const items = d.prepare(`SELECT * FROM book_order_items WHERE order_id=? ORDER BY id`).all(order.id);
    ok(order.status === 'invoice_pending' && order.total_cents === 13000, 'order invoice_pending; total covers books only ($130)');
    const p1 = items.find(i => i.book_slug === 'poster-66-step');
    const p3 = items.find(i => i.book_slug === 'poster-wall-set');
    ok(p1?.qty === 1 && p3?.qty === 3 && p1.unit_price_cents === 0 && /quoted on order/.test(p1.book_title), 'poster line items recorded at qty with quoted-on-order pricing');
    d.close();
  }
  r = await ownr('POST', '/orders', { 'qty_poster-66-step': '2', shipName: 'Casey Owner', shipAddress: '123 Main St' });
  ok(r.status === 302 && /message=/.test(r.location), 'poster-only order records');
  r = await ownr('GET', '/orders');
  ok(r.text.includes('plus posters, quoted on invoice'), 'order history flags quoted poster pricing');
  r = await admin('GET', '/admin/orders');
  ok(r.text.includes('66-Step Process Poster'), 'hab_admin order view lists poster items');

  // ===== 9. Double-boot idempotency =====
  console.log('\n9. Boot idempotency (reboot, no dupes)');
  const snap = () => {
    const d = db();
    const t = {};
    for (const tbl of ['shops', 'users', 'org_units', 'agreements', 'sync_queue', 'advisor_scorecards', 'shop_scorecards', 'check_attempts', 'content_time', 'points_ledger', 'book_orders', 'book_order_items']) {
      t[tbl] = d.prepare(`SELECT COUNT(*) c FROM ${tbl}`).get().c;
    }
    d.close();
    return t;
  };
  const before = snap();
  await stopServer(child);
  ({ child } = startServer());
  await waitUp();
  await sleep(1000);
  const after = snap();
  ok(JSON.stringify(before) === JSON.stringify(after), `two boots leave every table count unchanged (${JSON.stringify(after)})`);

} catch (e) {
  failed++;
  console.error('\nTEST CRASH:', e);
} finally {
  child.kill();
  stub.close();
}

console.log(`\n===== WP-ACADEMY-2: ${passed} passed, ${failed} failed =====`);
process.exit(failed ? 1 : 0);
