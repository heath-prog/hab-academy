// WP-ACADEMY-2: time-on-page rollups. Raw 30-second heartbeats land in
// content_time (see routes/api.js); this module aggregates them for the two
// surfaces that are allowed to see them: shop owners (their own shop) and
// hab_admin (every shop). Advisor and coach UI carries no reference to any
// of this — that invisibility is the point.
import db from './db.js';
import { Curriculum } from './curriculum.js';

const todayISO = () => new Date().toISOString().slice(0, 10);

export function recordBeat({ userId, shopId, contentKey, seconds = 30 }) {
  db.prepare(
    `INSERT INTO content_time (user_id, shop_id, day, content_key, seconds, last_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, day, content_key) DO UPDATE SET
       seconds = seconds + excluded.seconds, last_at = CURRENT_TIMESTAMP`
  ).run(userId, shopId ?? null, todayISO(), String(contentKey).slice(0, 80), seconds);
}

const titleFor = (key) => {
  if (key.startsWith('book:')) {
    const slug = key.slice(5);
    return `Book: ${slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`;
  }
  const ch = Curriculum.bySlug(key);
  return ch ? (ch.moduleKey ? `${ch.moduleKey} · ${ch.title}` : ch.title) : key;
};

// Per-user engagement for one shop: total minutes per content key + last active.
export function shopEngagement(shopId) {
  const users = db.prepare(
    `SELECT id, name, email, role FROM users WHERE shop_id = ? AND active = 1 ORDER BY role, name, email`
  ).all(shopId);
  const rows = db.prepare(
    `SELECT ct.user_id, ct.content_key, SUM(ct.seconds) AS secs, MAX(ct.last_at) AS last_at
     FROM content_time ct JOIN users u ON u.id = ct.user_id
     WHERE u.shop_id = ? AND u.active = 1
     GROUP BY ct.user_id, ct.content_key`
  ).all(shopId);
  const byUser = {};
  for (const r of rows) (byUser[r.user_id] ||= []).push(r);
  return users.map(u => {
    const mine = (byUser[u.id] || []).sort((a, b) => b.secs - a.secs);
    const totalSecs = mine.reduce((a, r) => a + r.secs, 0);
    const lastAt = mine.reduce((a, r) => (r.last_at > a ? r.last_at : a), '');
    return {
      id: u.id, name: u.name, email: u.email, role: u.role,
      totalMinutes: Math.round(totalSecs / 60),
      lastActive: lastAt || null,
      byContent: mine.map(r => ({
        key: r.content_key,
        title: titleFor(r.content_key),
        minutes: Math.round(r.secs / 60),
        lastAt: r.last_at,
      })),
    };
  });
}

// hab_admin: every shop's totals, for the all-shops view.
export function allShopsEngagement() {
  return db.prepare(
    `SELECT s.id, s.name, COUNT(DISTINCT ct.user_id) AS readers,
            COALESCE(SUM(ct.seconds), 0) AS secs, MAX(ct.last_at) AS last_at
     FROM shops s
     LEFT JOIN users u ON u.shop_id = s.id AND u.active = 1
     LEFT JOIN content_time ct ON ct.user_id = u.id
     WHERE s.active = 1
     GROUP BY s.id ORDER BY secs DESC, s.name`
  ).all().map(r => ({
    shopId: r.id, shopName: r.name, readers: r.readers,
    totalMinutes: Math.round(r.secs / 60), lastActive: r.last_at || null,
  }));
}
