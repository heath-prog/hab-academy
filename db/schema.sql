-- HAB Academy schema
-- Roles: hab_admin (Heath) > owner / coach (shop leadership) > advisor.
-- Legacy roles super_admin/manager are migrated in lib/db.js on boot.

CREATE TABLE IF NOT EXISTS shops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT UNIQUE NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS invites (
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

-- ===== Training progress =====

-- One row per completed curriculum section (module_key M1-M9, section_slug from content/curriculum/*.json)
CREATE TABLE IF NOT EXISTS section_progress (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_key   TEXT NOT NULL,
  section_slug TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, module_key, section_slug)
);

-- Append-only points ledger. reason: 'section' | 'checkin' | 'adjust'
CREATE TABLE IF NOT EXISTS points_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id    INTEGER REFERENCES shops(id) ON DELETE SET NULL,
  points     INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  ref        TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Daily Take-Five check-ins (one per user per local date, YYYY-MM-DD)
CREATE TABLE IF NOT EXISTS checkins (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_date TEXT NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, checkin_date)
);

-- Mastery ladder awards (manual, by coach/owner/hab_admin).
-- Current level = MAX(level); 1=Rookie 2=Advisor 3=Closer 4=Pro 5=Champion.
CREATE TABLE IF NOT EXISTS mastery_awards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level      INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
  awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invites_token   ON invites(token);
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_shop      ON users(shop_id);
CREATE INDEX IF NOT EXISTS idx_progress_user   ON section_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_points_user     ON points_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_points_shop     ON points_ledger(shop_id);
CREATE INDEX IF NOT EXISTS idx_checkins_user   ON checkins(user_id);
CREATE INDEX IF NOT EXISTS idx_mastery_user    ON mastery_awards(user_id);
