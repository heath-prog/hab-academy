-- HAB Academy schema
-- Roles: hab_admin (Heath) > owner / coach (shop leadership) > advisor.
-- Legacy roles super_admin/manager are migrated in lib/db.js on boot.

-- Organizational Units (MSO layer): a brand/enterprise that owns one or more shops.
-- Seeded idempotently on boot in lib/db.js (name-heuristic linking of legacy shops).
CREATE TABLE IF NOT EXISTS org_units (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT UNIQUE NOT NULL,
  join_code   TEXT UNIQUE,          -- WP-SIGNUP: team self-serve join code (shown to owner + hab_admin)
  is_demo     INTEGER NOT NULL DEFAULT 0, -- WP-SIGNUP: demo shops are exempt from agreement enforcement
  org_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
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
  title         TEXT, -- optional job title (e.g. Technician); does not affect access tier
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
CREATE INDEX IF NOT EXISTS idx_shops_org       ON shops(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_progress_user   ON section_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_points_user     ON points_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_points_shop     ON points_ledger(shop_id);
CREATE INDEX IF NOT EXISTS idx_checkins_user   ON checkins(user_id);
CREATE INDEX IF NOT EXISTS idx_mastery_user    ON mastery_awards(user_id);

-- Single-use password reset tokens. Only the sha256 hash of the token is
-- stored; the raw token lives in the emailed/logged link. 1-hour expiry.
CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_resets_token ON password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_resets_user  ON password_resets(user_id);

-- ===== WP-SIGNUP: tiered agreements, self-serve onboarding, book orders =====

-- Click-wrap agreement record. One active row per shop; a full HTML snapshot
-- of the signed document is stored so the signed record never drifts when the
-- template changes. Every snapshot carries a DRAFT FOR ATTORNEY REVIEW footer.
CREATE TABLE IF NOT EXISTS agreements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id        INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  owner_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tier           TEXT NOT NULL CHECK(tier IN ('consulting','portfolio')),
  term_months    INTEGER NOT NULL CHECK(term_months IN (6,12,24,36)),
  start_date     TEXT NOT NULL,  -- YYYY-MM-DD
  end_date       TEXT NOT NULL,  -- YYYY-MM-DD
  gp_fee_pct     REAL,           -- consulting: 5 (% of monthly gross profit dollars)
  mgmt_fee_pct   REAL,           -- portfolio: 2.5 (% of monthly gross profit)
  equity_pct     REAL,           -- portfolio: 10 (SAFE equity stake)
  signed_name    TEXT NOT NULL,  -- typed full-name signature
  signed_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip             TEXT,
  agreement_html TEXT NOT NULL,  -- immutable snapshot of the signed document
  safe_html      TEXT,           -- portfolio tier: generated SAFE instrument
  safe_status    TEXT,           -- portfolio tier: 'pending_countersignature' until Heath countersigns
  status         TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','terminated')),
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agreements_shop ON agreements(shop_id);

-- Coach/owner self-signups that need owner approval before an account exists.
CREATE TABLE IF NOT EXISTS pending_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id       INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('coach','owner')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied')),
  decided_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pending_members_shop ON pending_members(shop_id);

-- Printed book orders. No card processing yet: orders are recorded with status
-- 'invoice_pending' and HAB invoices manually. Stripe integration comes later.
CREATE TABLE IF NOT EXISTS book_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id       INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'invoice_pending' CHECK(status IN ('invoice_pending','invoiced','shipped','cancelled')),
  ship_name     TEXT NOT NULL,
  ship_address  TEXT NOT NULL,
  bill_address  TEXT NOT NULL,
  total_cents   INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_book_orders_shop ON book_orders(shop_id);

CREATE TABLE IF NOT EXISTS book_order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES book_orders(id) ON DELETE CASCADE,
  book_slug        TEXT NOT NULL,
  book_title       TEXT NOT NULL,
  qty              INTEGER NOT NULL CHECK(qty > 0),
  unit_price_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_order_items_order ON book_order_items(order_id);
