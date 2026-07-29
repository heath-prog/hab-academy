// WP-SIGNUP end-to-end test against a throwaway database.
// Boots the real server on a temp DB, then walks: owner signup (consulting),
// team join via code, portfolio signup with SAFE, PDF lockdown, book orders,
// expiry hard cutoff, pending coach approval, hab_admin visibility, and an
// idempotent reboot. Run: node scripts/test-wp-signup.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const TEST_DIR = '/tmp/hab-wp-signup-test';
const PORT = 4123;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = 'heath@healthyautobusiness.com';
const ADMIN_PASS = 'HabAdmin2026!';

let passed = 0, failed = 0;
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); }
};

// Minimal cookie-jar client (redirects handled manually).
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

function startServer() {
  const child = spawn('node', ['server.js'], {
    env: { ...process.env, DATA_DIR: TEST_DIR, DB_PATH: `${TEST_DIR}/academy.db`, PORT: String(PORT), NODE_ENV: '' },
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

fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DIR, { recursive: true });

let { child, getLog } = startServer();
await waitUp();
const db = () => new Database(`${TEST_DIR}/academy.db`);

try {
  // ===== 1. Owner signup, consulting tier =====
  console.log('\n1. Owner self-serve signup (consulting, 12 months)');
  const owner = client();
  let r = await owner('POST', '/signup/owner', {
    name: 'Casey Owner', email: 'casey@testshop.com', password: 'password123', confirm: 'password123',
    shopName: 'Test Shop Automotive', brandName: '', tier: 'consulting', term: '12',
  });
  ok(r.status === 302 && r.location === '/signup/agreement', 'owner form redirects to agreement step');
  r = await owner('GET', '/signup/agreement');
  ok(r.status === 200 && r.text.includes('Consulting Services Agreement'), 'agreement step renders the consulting agreement');
  ok(r.text.includes('5% of the Shop'), 'agreement shows the 5% GP fee');
  r = await owner('POST', '/signup/agreement', { agree: 'on', signedName: 'Casey Alexander Owner' });
  ok(r.status === 302 && r.location === '/dashboard', 'signing redirects to dashboard');

  let d = db();
  const shop = d.prepare(`SELECT * FROM shops WHERE name = 'Test Shop Automotive'`).get();
  const ag = shop && d.prepare('SELECT * FROM agreements WHERE shop_id = ?').get(shop.id);
  const orgLinked = shop && d.prepare('SELECT * FROM org_units WHERE id = ?').get(shop.org_unit_id);
  ok(!!shop, 'shop row created');
  ok(!!shop?.join_code && /^[A-Z2-9]{6}$/.test(shop.join_code), `join code generated (${shop?.join_code})`);
  ok(!!orgLinked, `org unit created and linked ("${orgLinked?.name}")`);
  ok(ag && ag.tier === 'consulting' && ag.term_months === 12 && ag.status === 'active', 'agreement row: consulting, 12mo, active');
  ok(ag && ag.gp_fee_pct === 5 && ag.signed_name === 'Casey Alexander Owner', 'agreement records 5% GP fee and typed signature');
  ok(ag && ag.agreement_html.toLowerCase().includes('draft for attorney review'), 'signed snapshot carries the attorney-review footer');
  ok(ag && ag.agreement_html.includes('HAB Enterprises 3 LLC'), 'signed snapshot names HAB Enterprises 3 LLC');
  const joinCode = shop.join_code;
  const agreementId = ag.id;
  d.close();

  r = await owner('GET', '/dashboard');
  ok(r.status === 200 && r.text.includes(joinCode), 'owner dashboard shows the join code');
  r = await owner('GET', `/agreements/${agreementId}`);
  ok(r.status === 200 && r.text.includes('Casey Alexander Owner'), 'owner can view the signed agreement snapshot');

  // ===== 2. Team member joins via code =====
  console.log('\n2. Advisor joins with the shop join code');
  const advisor = client();
  r = await advisor('POST', '/join', {
    code: joinCode, name: 'Riley Advisor', email: 'riley@testshop.com',
    password: 'password123', confirm: 'password123', role: 'advisor',
  });
  ok(r.status === 302 && r.location === '/dashboard', 'advisor join logs in and redirects to dashboard');
  r = await advisor('GET', '/library');
  ok(r.status === 200 && r.text.includes('HAB Advisor Book'), 'advisor can read the library while agreement active');
  ok(!r.text.includes('/library/advisor-book/pdf'), 'library page hides PDF links from the advisor');
  r = await advisor('GET', '/library/advisor-book/pdf');
  ok(r.status === 403, 'PDF route denies the advisor (403)');
  r = await advisor('GET', '/content/advisor/' + encodeURIComponent('HEALTHY AUTO BUSINESS Script book.pdf'));
  ok(r.status === 403, 'content book PDF denies the advisor (403)');
  const badJoin = client();
  r = await badJoin('POST', '/join', {
    code: 'WRONG1', name: 'X', email: 'x@x.com', password: 'password123', confirm: 'password123', role: 'advisor',
  });
  ok(r.status === 302 && /join/.test(r.location || ''), 'bad join code is rejected');

  // ===== 3. Coach signup needs owner approval =====
  console.log('\n3. Coach signup requires owner approval');
  const coach = client();
  r = await coach('POST', '/join', {
    code: joinCode, name: 'Morgan Coach', email: 'morgan@testshop.com',
    password: 'password123', confirm: 'password123', role: 'coach',
  });
  ok(r.status === 200 && /awaiting approval/i.test(r.text), 'coach signup lands on awaiting-approval page');
  r = await coach('POST', '/login', { email: 'morgan@testshop.com', password: 'password123' });
  ok(r.status === 302 && /error/.test(r.location || ''), 'pending coach cannot log in yet');
  d = db();
  const pm = d.prepare(`SELECT * FROM pending_members WHERE email = 'morgan@testshop.com'`).get();
  d.close();
  ok(pm && pm.status === 'pending', 'pending_members row recorded');
  r = await owner('GET', '/dashboard');
  ok(r.text.includes('Morgan Coach') && r.text.includes(`/team/pending/${pm.id}/approve`), 'owner dashboard lists the pending request');
  r = await owner('POST', `/team/pending/${pm.id}/approve`);
  ok(r.status === 302, 'owner approves the coach');
  r = await coach('POST', '/login', { email: 'morgan@testshop.com', password: 'password123' });
  ok(r.status === 302 && r.location === '/dashboard', 'approved coach can log in');

  // ===== 4. Book order flow =====
  console.log('\n4. Printed book order (invoice pending)');
  r = await owner('GET', '/orders');
  ok(r.status === 200 && r.text.includes('$65.00'), 'order page renders with $65 per copy');
  r = await owner('POST', '/orders', {
    'qty_advisor-book': '3', 'qty_script-book': '2', 'qty_coachs-book': '0',
    shipName: 'Casey Owner, Test Shop', shipAddress: '123 Main St, Sacramento, CA 95814', billAddress: '',
  });
  ok(r.status === 302 && /message=/.test(r.location || ''), 'order posts successfully');
  d = db();
  const order = d.prepare('SELECT * FROM book_orders WHERE shop_id = ?').get(shop.id);
  const items = order && d.prepare('SELECT * FROM book_order_items WHERE order_id = ? ORDER BY id').all(order.id);
  d.close();
  ok(order && order.status === 'invoice_pending', 'order recorded with status invoice_pending');
  ok(order && order.total_cents === 5 * 6500, 'order total is 5 copies x $65');
  ok(items && items.length === 2 && items[0].qty === 3, 'order items recorded (zero-qty book skipped)');
  r = await owner('GET', '/orders');
  ok(r.text.includes('INVOICE PENDING'), 'owner order history shows invoice pending');
  r = await advisor('GET', '/orders');
  ok(r.status === 403, 'advisor cannot open the order page');

  // ===== 5. Mastery promotion notification =====
  console.log('\n5. Mastery promotion logs a notification');
  d = db();
  const rileyId = d.prepare(`SELECT id FROM users WHERE email = 'riley@testshop.com'`).get().id;
  d.close();
  r = await owner('POST', '/team/mastery', { userId: String(rileyId), level: '3', note: 'closed it live' });
  ok(r.status === 302 && /promoted/.test(decodeURIComponent(r.location || '')), 'promotion posts');
  await new Promise(r => setTimeout(r, 300));
  ok(getLog().includes('promotion email for riley@testshop.com'), 'promotion email logged to console (no SMTP creds)');
  ok(getLog().includes('welcome email for riley@testshop.com'), 'signup welcome email logged to console');

  // ===== 6. Portfolio tier signup generates a SAFE =====
  console.log('\n6. Portfolio (PE) signup generates the SAFE');
  const peOwner = client();
  await peOwner('POST', '/signup/owner', {
    name: 'Drew Partner', email: 'drew@peshop.com', password: 'password123', confirm: 'password123',
    shopName: 'PE Test Motors', brandName: 'Blackline Auto Group', tier: 'portfolio', term: '36',
  });
  r = await peOwner('GET', '/signup/agreement');
  ok(r.status === 200 && r.text.includes('Portfolio Package'), 'portfolio agreement renders');
  ok(/90%/.test(r.text), 'portfolio agreement shows the 90/5/5 split');
  r = await peOwner('POST', '/signup/agreement', { agree: 'on', signedName: 'Drew Michael Partner' });
  ok(r.status === 302 && r.location === '/dashboard', 'portfolio signing completes');
  d = db();
  const peShop = d.prepare(`SELECT * FROM shops WHERE name = 'PE Test Motors'`).get();
  const peAg = d.prepare('SELECT * FROM agreements WHERE shop_id = ?').get(peShop.id);
  const peOrg = d.prepare('SELECT * FROM org_units WHERE id = ?').get(peShop.org_unit_id);
  d.close();
  ok(peAg && peAg.tier === 'portfolio' && peAg.mgmt_fee_pct === 2.5 && peAg.equity_pct === 10, 'portfolio agreement: 2.5% mgmt fee, 10% equity');
  ok(peAg && peAg.safe_html && peAg.safe_status === 'pending_countersignature', 'SAFE stored, pending countersignature');
  ok(peOrg && peOrg.name === 'Blackline Auto Group', 'explicit brand name created the org unit');
  ok(peAg.safe_html.includes('War Chest') && peAg.safe_html.includes('majority vote'), 'SAFE includes War Chest voting rules');
  r = await peOwner('GET', `/agreements/${peAg.id}/safe`);
  ok(r.status === 200 && /Pending HAB Countersignature/i.test(r.text), 'owner can view the SAFE, marked pending countersignature');
  r = await advisor('GET', `/agreements/${peAg.id}`);
  ok(r.status === 403, 'another shop user cannot view that agreement');

  // ===== 7. Expiry hard cutoff =====
  console.log('\n7. Expired agreement locks the shop out');
  d = db();
  d.prepare(`UPDATE agreements SET end_date = '2025-01-01' WHERE id = ?`).run(agreementId);
  d.close();
  r = await advisor('GET', '/library');
  ok(r.status === 302 && r.location === '/agreement-ended', 'advisor is redirected to the agreement-ended page');
  r = await advisor('GET', '/curriculum');
  ok(r.status === 302 && r.location === '/agreement-ended', 'curriculum blocked too');
  r = await advisor('GET', '/agreement-ended');
  ok(r.status === 200 && r.text.includes('agreement has ended'), 'agreement-ended page renders');
  r = await owner('POST', '/orders', {
    'qty_advisor-book': '1', shipName: 'x', shipAddress: 'y', billAddress: '',
  });
  ok(r.status === 403, 'ordering is blocked when the agreement is expired');
  r = await owner('GET', '/dashboard');
  ok(r.status === 302 && r.location === '/agreement-ended', 'owner is cut off as well');
  r = await owner('GET', `/agreements/${agreementId}`);
  ok(r.status === 200, 'owner can still view the signed agreement record');
  d = db();
  const agAfter = d.prepare('SELECT status FROM agreements WHERE id = ?').get(agreementId);
  d.close();
  ok(agAfter.status === 'expired', 'agreement status auto-flipped to expired');

  // ===== 8. hab_admin sees everything, is exempt =====
  console.log('\n8. hab_admin visibility and exemption');
  const admin = client();
  r = await admin('POST', '/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
  ok(r.status === 302 && r.location === '/admin', 'hab_admin logs in');
  r = await admin('GET', '/admin/shops');
  ok(r.status === 200 && r.text.includes(joinCode), 'Shops Management shows the join code');
  ok(r.text.includes('HAB Consulting') && r.text.includes('HAB Portfolio'), 'Shops Management shows tiers');
  ok(r.text.includes('Expired') && r.text.includes('Active'), 'Shops Management shows agreement status');
  ok(r.text.includes(`/agreements/${peAg.id}/safe`), 'Shops Management links to the SAFE');
  r = await admin('GET', '/admin/orders');
  ok(r.status === 200 && r.text.includes('Test Shop Automotive') && r.text.includes('INVOICE PENDING'), 'hab_admin order list shows the order');
  r = await admin('GET', '/library/advisor-book/pdf');
  ok(r.status === 200, `hab_admin passes the PDF gate (${r.status})`);
  r = await admin('GET', `/agreements/${agreementId}`);
  ok(r.status === 200, 'hab_admin can view any agreement');
  // demo flag exempts a shop
  r = await admin('POST', `/admin/shops/${shop.id}/demo`);
  ok(r.status === 302, 'demo toggle posts');
  r = await advisor('GET', '/dashboard');
  ok(r.status === 200, 'demo-flagged shop is exempt from enforcement');
  await admin('POST', `/admin/shops/${shop.id}/demo`); // flip back
  r = await advisor('GET', '/dashboard');
  ok(r.status === 302 && r.location === '/agreement-ended', 'flipping back re-enforces the cutoff');

  // ===== 9. Idempotent reboot =====
  console.log('\n9. Reboot is idempotent');
  d = db();
  const counts1 = {
    shops: d.prepare('SELECT COUNT(*) c FROM shops').get().c,
    users: d.prepare('SELECT COUNT(*) c FROM users').get().c,
    ags: d.prepare('SELECT COUNT(*) c FROM agreements').get().c,
    orgs: d.prepare('SELECT COUNT(*) c FROM org_units').get().c,
  };
  d.close();
  child.kill();
  await new Promise(r => setTimeout(r, 800));
  ({ child, getLog } = startServer());
  await waitUp();
  d = db();
  const counts2 = {
    shops: d.prepare('SELECT COUNT(*) c FROM shops').get().c,
    users: d.prepare('SELECT COUNT(*) c FROM users').get().c,
    ags: d.prepare('SELECT COUNT(*) c FROM agreements').get().c,
    orgs: d.prepare('SELECT COUNT(*) c FROM org_units').get().c,
  };
  const codesNull = d.prepare('SELECT COUNT(*) c FROM shops WHERE join_code IS NULL').get().c;
  d.close();
  ok(JSON.stringify(counts1) === JSON.stringify(counts2), `reboot changes nothing (${JSON.stringify(counts2)})`);
  ok(codesNull === 0, 'every shop still has a join code after reboot');
  const fresh = client();
  r = await fresh('GET', '/login');
  ok(r.status === 200 && r.text.includes('Sign up'), 'login page carries the Sign up link');
} finally {
  child.kill();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
