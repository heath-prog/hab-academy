// SQLite wrapper. Single shared connection.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'academy.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
// Prefer WAL; fall back on filesystems that block the deletes WAL setup needs.
for (const mode of ['WAL', 'PERSIST', 'MEMORY']) {
  try { db.pragma(`journal_mode = ${mode}`); break; } catch { /* try next */ }
}
db.pragma('foreign_keys = ON');

// Apply schema if empty
const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
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

const today = () => new Date().toISOString().slice(0, 10);

// ===== Helpers =====
export const Users = {
  byEmail: (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email),
  byId:    (id)    => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
  create:  ({ email, password_hash, role, shop_id, name }) =>
    db.prepare(
      `INSERT INTO users (email, password_hash, role, shop_id, name)
       VALUES (?, ?, ?, ?, ?)`
    ).run(email, password_hash, role, shop_id, name).lastInsertRowid,
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
  all:    ()     => db.prepare('SELECT * FROM shops ORDER BY created_at DESC').all(),
  create: ({ name, code }) =>
    db.prepare('INSERT INTO shops (name, code) VALUES (?, ?)').run(name, code).lastInsertRowid,
  countUsers: (shopId) =>
    db.prepare('SELECT COUNT(*) as c FROM users WHERE shop_id = ? AND active = 1').get(shopId).c,
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

export default db;
