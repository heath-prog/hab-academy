// SQLite wrapper. Single shared connection.
import Database from 'better-sqlite3';
import { newJoinCode } from './tokens.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH  = process.env.DB_PATH || path.join(DATA_DIR, 'academy.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
// Prefer WAL; fall back on filesystems that block the deletes WAL setup needs.
for (const mode of ['WAL', 'PERSIST', 'MEMORY']) {
  try { db.pragma(`journal_mode = ${mode}`); break; } catch { /* try next */ }
}
db.pragma('foreign_keys = ON');

// ===== Pre-schema column guards =====
// schema.sql creates indexes on columns that older databases predate
// (shops.org_unit_id from WP-ORG, shops.join_code from WP-SIGNUP, ...), and
// db.exec stops at the first error. Add any missing columns BEFORE applying
// the schema so a legacy academy.db boots cleanly no matter its vintage.
const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
{
  const hasTable = (t) =>
    !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(t);
  if (hasTable('shops')) {
    // org_units must exist before shops.org_unit_id can reference it.
    db.exec(`CREATE TABLE IF NOT EXISTS org_units (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      slug        TEXT UNIQUE NOT NULL,
      created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const shopCols = db.prepare('PRAGMA table_info(shops)').all().map(c => c.name);
    if (!shopCols.includes('org_unit_id')) {
      console.log('[migrate] adding shops.org_unit_id…');
      db.exec('ALTER TABLE shops ADD COLUMN org_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL');
    }
    if (!shopCols.includes('join_code')) {
      console.log('[migrate] adding shops.join_code…');
      db.exec('ALTER TABLE shops ADD COLUMN join_code TEXT');
    }
    if (!shopCols.includes('is_demo')) {
      console.log('[migrate] adding shops.is_demo…');
      db.exec('ALTER TABLE shops ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_join_code ON shops(join_code)');
  }
  if (hasTable('users')) {
    const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    if (!userCols.includes('title')) {
      console.log('[migrate] adding users.title…');
      db.exec('ALTER TABLE users ADD COLUMN title TEXT');
    }
  }
}

// Apply schema if empty
db.exec(schemaSql);

// ===== Migration: legacy roles (super_admin/manager) -> (hab_admin/owner/coach/advisor) =====
// Pre-Academy databases have CHECK(role IN ('super_admin','manager','advisor')) baked into
// the table SQL. SQLite can't alter CHECK constraints, so rebuild the table once.
{
  const usersSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`).get()?.sql || '';
  if (usersSql.includes('super_admin')) {
    console.log('[migrate] rebuilding users/invites for new role set (hab_admin/owner/coach/advisor)…');
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE users_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          email         TEXT UNIQUE NOT NULL COLLATE NOCASE,
          password_hash TEXT,
          role          TEXT NOT NULL CHECK(role IN ('hab_admin','owner','coach','advisor')),
          shop_id       INTEGER REFERENCES shops(id) ON DELETE SET NULL,
          name          TEXT,
          created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_login    TEXT,
          active        INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO users_new (id,email,password_hash,role,shop_id,name,created_at,last_login,active)
          SELECT id,email,password_hash,
                 CASE role WHEN 'super_admin' THEN 'hab_admin' WHEN 'manager' THEN 'owner' ELSE role END,
                 shop_id,name,created_at,last_login,active
          FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;

        CREATE TABLE invites_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          token       TEXT UNIQUE NOT NULL,
          email       TEXT NOT NULL COLLATE NOCASE,
          role        TEXT NOT NULL CHECK(role IN ('owner','coach','advisor')),
          shop_id     INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
          invited_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
          expires_at  TEXT NOT NULL,
          used_at     TEXT,
          created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO invites_new (id,token,email,role,shop_id,invited_by,expires_at,used_at,created_at)
          SELECT id,token,email,
                 CASE role WHEN 'manager' THEN 'owner' ELSE role END,
                 shop_id,invited_by,expires_at,used_at,created_at
          FROM invites;
        DROP TABLE invites;
        ALTER TABLE invites_new RENAME TO invites;
      `);
    })();
    db.pragma('foreign_keys = ON');
    db.exec(schemaSql); // recreate indexes dropped with the old tables
    console.log('[migrate] role migration complete.');
  }
}

// ===== Migration: WP-ORG v1 — organizational units (MSO layer) =====
// org_units table itself comes from schema.sql (CREATE TABLE IF NOT EXISTS).
// Older databases predate shops.org_unit_id, so add the column if missing.
{
  const shopCols = db.prepare('PRAGMA table_info(shops)').all().map(c => c.name);
  if (!shopCols.includes('org_unit_id')) {
    console.log('[migrate] adding shops.org_unit_id…');
    db.exec('ALTER TABLE shops ADD COLUMN org_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_shops_org ON shops(org_unit_id)');
  }
}

// ===== Migration: WP-SIGNUP — join codes, demo flag, member titles =====
// Existing databases predate shops.join_code / shops.is_demo / users.title.
{
  const shopCols = db.prepare('PRAGMA table_info(shops)').all().map(c => c.name);
  if (!shopCols.includes('join_code')) {
    console.log('[migrate] adding shops.join_code…');
    db.exec('ALTER TABLE shops ADD COLUMN join_code TEXT');
  }
  if (!shopCols.includes('is_demo')) {
    console.log('[migrate] adding shops.is_demo…');
    db.exec('ALTER TABLE shops ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_join_code ON shops(join_code)');

  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userCols.includes('title')) {
    console.log('[migrate] adding users.title…');
    db.exec('ALTER TABLE users ADD COLUMN title TEXT');
  }
}

// ===== Migration: WP-ACADEMY-2 — shop contact fields (address/phone/website) =====
// Optional fields captured on the owner-signup shop form; older databases
// predate them. Idempotent column adds, same pattern as the blocks above.
{
  const shopCols = db.prepare('PRAGMA table_info(shops)').all().map(c => c.name);
  for (const col of ['address', 'phone', 'website']) {
    if (!shopCols.includes(col)) {
      console.log(`[migrate] adding shops.${col}…`);
      db.exec(`ALTER TABLE shops ADD COLUMN ${col} TEXT`);
    }
  }
}

// ===== Boot seed: every shop gets a join code (idempotent) =====
{
  const missing = db.prepare('SELECT id, name FROM shops WHERE join_code IS NULL').all();
  for (const s of missing) {
    let code;
    do { code = newJoinCode(); } while (db.prepare('SELECT 1 FROM shops WHERE join_code = ?').get(code));
    db.prepare('UPDATE shops SET join_code = ? WHERE id = ?').run(code, s.id);
    console.log(`[join-seed] shop "${s.name}" join code: ${code}`);
  }
}

// ===== Boot seed: organizational units (idempotent) =====
// Every shop belongs to exactly one org unit. Known HAB client brands are
// matched by name heuristics; any other shop gets an org unit of its own name.
// Lookups are by slug, so restarts never duplicate org units.
export const slugifyOrg = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function ensureOrgUnit(name) {
  const slug = slugifyOrg(name);
  let ou = db.prepare('SELECT * FROM org_units WHERE slug = ?').get(slug);
  if (!ou) {
    db.prepare('INSERT INTO org_units (name, slug) VALUES (?, ?)').run(name, slug);
    ou = db.prepare('SELECT * FROM org_units WHERE slug = ?').get(slug);
    console.log(`[org-seed] created org unit: ${name}`);
  }
  return ou;
}

// Name heuristics for known multi-shop brands. Unmatched shops become their own org.
export function orgNameForShop(shopName) {
  const n = String(shopName).toLowerCase();
  if (/twin\s*view|hartnell|andrews/.test(n)) return 'Andrews Auto';
  if (/apex/.test(n))    return 'Apex Auto Center';
  if (/rocklin/.test(n)) return 'Rocklin Automotive';
  return String(shopName).trim();
}

export function assignShopToOrg(shopId, shopName) {
  const ou = ensureOrgUnit(orgNameForShop(shopName));
  db.prepare('UPDATE shops SET org_unit_id = ? WHERE id = ?').run(ou.id, shopId);
  return ou;
}

// WP-SIGNUP: owner gave an explicit org/brand name — use it verbatim (created
// if new, reused by slug if it already exists) instead of the name heuristics.
export function assignShopToNamedOrg(shopId, orgName) {
  const ou = ensureOrgUnit(String(orgName).trim());
  db.prepare('UPDATE shops SET org_unit_id = ? WHERE id = ?').run(ou.id, shopId);
  return ou;
}

{
  const unassigned = db.prepare('SELECT id, name FROM shops WHERE org_unit_id IS NULL').all();
  for (const s of unassigned) {
    const ou = assignShopToOrg(s.id, s.name);
    console.log(`[org-seed] linked shop "${s.name}" -> org "${ou.name}"`);
  }
}

const today = () => new Date().toISOString().slice(0, 10);

// ===== Helpers =====
export const Users = {
  byEmail: (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email),
  byId:    (id)    => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
  create:  ({ email, password_hash, role, shop_id, name, title }) =>
    db.prepare(
      `INSERT INTO users (email, password_hash, role, shop_id, name, title)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(email, password_hash, role, shop_id, name, title ?? null).lastInsertRowid,
  setPassword: (id, hash) =>
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id),
  touchLogin: (id) =>
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(id),
  listByShop: (shopId) =>
    db.prepare('SELECT id, email, role, name, last_login, active FROM users WHERE shop_id = ? ORDER BY role, email').all(shopId),
  activeByShop: (shopId) =>
    db.prepare('SELECT id, email, role, name FROM users WHERE shop_id = ? AND active = 1 ORDER BY role, name, email').all(shopId),
  deactivate: (id) =>
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id),
};

export const Shops = {
  byId:   (id)   => db.prepare('SELECT * FROM shops WHERE id = ?').get(id),
  byCode: (code) => db.prepare('SELECT * FROM shops WHERE code = ?').get(code),
  byJoinCode: (joinCode) =>
    db.prepare('SELECT * FROM shops WHERE join_code = ? AND active = 1').get(joinCode),
  all:    ()     => db.prepare('SELECT * FROM shops ORDER BY created_at DESC').all(),
  create: ({ name, code, join_code, address, phone, website }) =>
    db.prepare('INSERT INTO shops (name, code, join_code, address, phone, website) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, code, join_code ?? null, address ?? null, phone ?? null, website ?? null).lastInsertRowid,
  setDemo: (id, isDemo) =>
    db.prepare('UPDATE shops SET is_demo = ? WHERE id = ?').run(isDemo ? 1 : 0, id),
  countUsers: (shopId) =>
    db.prepare('SELECT COUNT(*) as c FROM users WHERE shop_id = ? AND active = 1').get(shopId).c,
};

export const OrgUnits = {
  byId:   (id)   => db.prepare('SELECT * FROM org_units WHERE id = ?').get(id),
  bySlug: (slug) => db.prepare('SELECT * FROM org_units WHERE slug = ?').get(slug),
  all:    ()     => db.prepare('SELECT * FROM org_units ORDER BY name COLLATE NOCASE').all(),
  shopsFor: (orgId) =>
    db.prepare('SELECT * FROM shops WHERE org_unit_id = ? AND active = 1 ORDER BY name COLLATE NOCASE').all(orgId),
};

export const Invites = {
  create: ({ token, email, role, shop_id, invited_by, expires_at }) =>
    db.prepare(
      `INSERT INTO invites (token, email, role, shop_id, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(token, email, role, shop_id, invited_by, expires_at).lastInsertRowid,
  byToken: (token) => db.prepare('SELECT * FROM invites WHERE token = ?').get(token),
  consume: (token) =>
    db.prepare('UPDATE invites SET used_at = CURRENT_TIMESTAMP WHERE token = ?').run(token),
  pendingForShop: (shopId) =>
    db.prepare(
      `SELECT id, email, role, expires_at, created_at FROM invites
       WHERE shop_id = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC`
    ).all(shopId),
  revoke: (id) => db.prepare('DELETE FROM invites WHERE id = ?').run(id),
};

// ===== Training progress =====
export const Progress = {
  complete: (userId, moduleKey, sectionSlug) =>
    db.prepare(
      `INSERT OR IGNORE INTO section_progress (user_id, module_key, section_slug) VALUES (?, ?, ?)`
    ).run(userId, moduleKey, sectionSlug).changes > 0,
  uncomplete: (userId, moduleKey, sectionSlug) =>
    db.prepare(
      `DELETE FROM section_progress WHERE user_id = ? AND module_key = ? AND section_slug = ?`
    ).run(userId, moduleKey, sectionSlug).changes > 0,
  slugsForUserModule: (userId, moduleKey) =>
    db.prepare('SELECT section_slug FROM section_progress WHERE user_id = ? AND module_key = ?')
      .all(userId, moduleKey).map(r => r.section_slug),
  countsByModuleForUser: (userId) => {
    const out = {};
    for (const r of db.prepare(
      'SELECT module_key, COUNT(*) AS c FROM section_progress WHERE user_id = ? GROUP BY module_key'
    ).all(userId)) out[r.module_key] = r.c;
    return out;
  },
  totalForUser: (userId) =>
    db.prepare('SELECT COUNT(*) AS c FROM section_progress WHERE user_id = ?').get(userId).c,
  // rows: user_id, module_key, c — for every active user in the shop
  matrixForShop: (shopId) =>
    db.prepare(
      `SELECT sp.user_id, sp.module_key, COUNT(*) AS c
       FROM section_progress sp JOIN users u ON u.id = sp.user_id
       WHERE u.shop_id = ? AND u.active = 1
       GROUP BY sp.user_id, sp.module_key`
    ).all(shopId),
};

// ===== Gamification =====
export const Points = {
  add: ({ userId, shopId, points, reason, ref }) =>
    db.prepare(
      `INSERT INTO points_ledger (user_id, shop_id, points, reason, ref) VALUES (?, ?, ?, ?, ?)`
    ).run(userId, shopId ?? null, points, reason, ref ?? null).lastInsertRowid,
  hasRef: (userId, reason, ref) =>
    !!db.prepare('SELECT 1 FROM points_ledger WHERE user_id = ? AND reason = ? AND ref = ?')
      .get(userId, reason, ref),
  removeByRef: (userId, reason, ref) =>
    db.prepare('DELETE FROM points_ledger WHERE user_id = ? AND reason = ? AND ref = ?')
      .run(userId, reason, ref).changes,
  totalForUser: (userId) =>
    db.prepare('SELECT COALESCE(SUM(points),0) AS p FROM points_ledger WHERE user_id = ?').get(userId).p,
  totalsForShop: (shopId) => {
    const out = {};
    for (const r of db.prepare(
      `SELECT pl.user_id, SUM(pl.points) AS p
       FROM points_ledger pl JOIN users u ON u.id = pl.user_id
       WHERE u.shop_id = ? AND u.active = 1 GROUP BY pl.user_id`
    ).all(shopId)) out[r.user_id] = r.p;
    return out;
  },
};

export const Checkins = {
  today: (userId) =>
    db.prepare('SELECT * FROM checkins WHERE user_id = ? AND checkin_date = ?').get(userId, today()),
  add: (userId, note) =>
    db.prepare('INSERT OR IGNORE INTO checkins (user_id, checkin_date, note) VALUES (?, ?, ?)')
      .run(userId, today(), note ?? null).changes > 0,
  datesForUser: (userId) =>
    db.prepare('SELECT checkin_date FROM checkins WHERE user_id = ? ORDER BY checkin_date DESC')
      .all(userId).map(r => r.checkin_date),
  // Consecutive-day streak ending today (or yesterday, so an unbroken streak
  // doesn't read as 0 before today's check-in).
  streakForUser: (userId) => {
    const dates = new Set(Checkins.datesForUser(userId));
    if (dates.size === 0) return 0;
    const d = new Date();
    const iso = (x) => x.toISOString().slice(0, 10);
    if (!dates.has(iso(d))) d.setUTCDate(d.getUTCDate() - 1); // allow "yesterday" anchor
    let streak = 0;
    while (dates.has(iso(d))) { streak++; d.setUTCDate(d.getUTCDate() - 1); }
    return streak;
  },
};

export const MASTERY_LEVELS = ['Rookie', 'Advisor', 'Closer', 'Pro', 'Champion']; // index+1 = level

export const Mastery = {
  award: ({ userId, level, awardedBy, note }) =>
    db.prepare('INSERT INTO mastery_awards (user_id, level, awarded_by, note) VALUES (?, ?, ?, ?)')
      .run(userId, level, awardedBy ?? null, note ?? null).lastInsertRowid,
  currentLevel: (userId) =>
    db.prepare('SELECT COALESCE(MAX(level),1) AS l FROM mastery_awards WHERE user_id = ?').get(userId).l,
  levelsForShop: (shopId) => {
    const out = {};
    for (const r of db.prepare(
      `SELECT ma.user_id, MAX(ma.level) AS l
       FROM mastery_awards ma JOIN users u ON u.id = ma.user_id
       WHERE u.shop_id = ? GROUP BY ma.user_id`
    ).all(shopId)) out[r.user_id] = r.l;
    return out;
  },
  levelName: (level) => MASTERY_LEVELS[Math.min(Math.max(level, 1), 5) - 1],
};

// ===== WP-SIGNUP: agreements (click-wrap on record) =====
export const Agreements = {
  create: ({ shop_id, owner_user_id, tier, term_months, start_date, end_date,
             gp_fee_pct, mgmt_fee_pct, equity_pct, signed_name, ip,
             agreement_html, safe_html, safe_status }) =>
    db.prepare(
      `INSERT INTO agreements
         (shop_id, owner_user_id, tier, term_months, start_date, end_date,
          gp_fee_pct, mgmt_fee_pct, equity_pct, signed_name, ip,
          agreement_html, safe_html, safe_status, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    ).run(shop_id, owner_user_id ?? null, tier, term_months, start_date, end_date,
          gp_fee_pct ?? null, mgmt_fee_pct ?? null, equity_pct ?? null,
          signed_name, ip ?? null, agreement_html, safe_html ?? null, safe_status ?? null)
      .lastInsertRowid,
  byId: (id) => db.prepare('SELECT * FROM agreements WHERE id = ?').get(id),
  latestForShop: (shopId) =>
    db.prepare('SELECT * FROM agreements WHERE shop_id = ? ORDER BY id DESC LIMIT 1').get(shopId),
  activeForShop: (shopId) =>
    db.prepare(`SELECT * FROM agreements WHERE shop_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`).get(shopId),
  markExpired: (id) =>
    db.prepare(`UPDATE agreements SET status = 'expired' WHERE id = ? AND status = 'active'`).run(id),
};

// ===== WP-SIGNUP: coach/owner signups awaiting owner approval =====
export const PendingMembers = {
  create: ({ shop_id, name, email, password_hash, role }) =>
    db.prepare(
      `INSERT INTO pending_members (shop_id, name, email, password_hash, role)
       VALUES (?, ?, ?, ?, ?)`
    ).run(shop_id, name, email, password_hash, role).lastInsertRowid,
  byId: (id) => db.prepare('SELECT * FROM pending_members WHERE id = ?').get(id),
  pendingForShop: (shopId) =>
    db.prepare(`SELECT * FROM pending_members WHERE shop_id = ? AND status = 'pending' ORDER BY created_at`).all(shopId),
  pendingByEmail: (email) =>
    db.prepare(`SELECT * FROM pending_members WHERE email = ? AND status = 'pending'`).get(email),
  decide: (id, status, decidedBy) =>
    db.prepare(`UPDATE pending_members SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(status, decidedBy ?? null, id),
};

// ===== WP-SIGNUP: printed book orders (invoice pending — no card processing yet) =====
export const BookOrders = {
  // items: [{ book_slug, book_title, qty, unit_price_cents }]
  create: ({ shop_id, user_id, ship_name, ship_address, bill_address, items }) => {
    const total = items.reduce((sum, i) => sum + i.qty * i.unit_price_cents, 0);
    return db.transaction(() => {
      const orderId = db.prepare(
        `INSERT INTO book_orders (shop_id, user_id, ship_name, ship_address, bill_address, total_cents)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(shop_id, user_id ?? null, ship_name, ship_address, bill_address, total).lastInsertRowid;
      const ins = db.prepare(
        `INSERT INTO book_order_items (order_id, book_slug, book_title, qty, unit_price_cents)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const i of items) ins.run(orderId, i.book_slug, i.book_title, i.qty, i.unit_price_cents);
      return orderId;
    })();
  },
  byId: (id) => db.prepare('SELECT * FROM book_orders WHERE id = ?').get(id),
  itemsFor: (orderId) =>
    db.prepare('SELECT * FROM book_order_items WHERE order_id = ? ORDER BY id').all(orderId),
  forShop: (shopId) =>
    db.prepare('SELECT * FROM book_orders WHERE shop_id = ? ORDER BY id DESC').all(shopId),
  all: () =>
    db.prepare(
      `SELECT bo.*, s.name AS shop_name, u.name AS user_name, u.email AS user_email
       FROM book_orders bo
       JOIN shops s ON s.id = bo.shop_id
       LEFT JOIN users u ON u.id = bo.user_id
       ORDER BY bo.id DESC`
    ).all(),
};

// ===== Password resets (single-use, hashed tokens, 1h expiry) =====
export const PasswordResets = {
  create: ({ user_id, token_hash, expires_at }) =>
    db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
      .run(user_id, token_hash, expires_at).lastInsertRowid,
  byTokenHash: (token_hash) =>
    db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(token_hash),
  consume: (id) =>
    db.prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(id),
  invalidateForUser: (userId) =>
    db.prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL')
      .run(userId),
};

export default db;
