// WP-ACADEMY-2: KPI scorecards — the shop's real numbers, entered daily.
// Doctrine: owning your numbers every day is a coaching tactic. The scoreboard
// is what makes the coaching conversation honest.
//
// Two entry types:
//   advisor_scorecards — per advisor per day: revenue, gross profit, car count.
//   shop_scorecards    — per shop per day: total revenue, gross profit, tax,
//                        cost of goods, car count (entered by owner/coach).
// ARO and GP% are always DERIVED (never stored): ARO = revenue / car count,
// GP% = gross profit / revenue.
//
// Edit lock: an entry stays editable for EDIT_WINDOW_DAYS days after its entry
// date, then locks. hab_admin is exempt and can always edit.
import db from './db.js';

export const EDIT_WINDOW_DAYS = 7;

const todayISO = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;

export const aro = (revenue, carCount) => (carCount > 0 ? round2(revenue / carCount) : null);
export const gpPct = (grossProfit, revenue) => (revenue > 0 ? round2((grossProfit / revenue) * 100) : null);

// Entry is editable while its entry_date is within the last EDIT_WINDOW_DAYS.
export function isEditable(entryDate, role) {
  if (role === 'hab_admin') return true;
  const ageDays = Math.floor((Date.parse(todayISO()) - Date.parse(entryDate)) / 86400000);
  return ageDays >= 0 ? ageDays <= EDIT_WINDOW_DAYS : true; // future dates are rejected upstream
}

function decorateAdvisor(row) {
  if (!row) return row;
  return { ...row, aro: aro(row.revenue, row.car_count), gp_pct: gpPct(row.gross_profit, row.revenue) };
}
function decorateShop(row) {
  if (!row) return row;
  return { ...row, aro: aro(row.total_revenue, row.car_count), gp_pct: gpPct(row.gross_profit, row.total_revenue) };
}

export const AdvisorScorecards = {
  upsert: ({ user_id, shop_id, entry_date, revenue, gross_profit, car_count }) =>
    db.prepare(
      `INSERT INTO advisor_scorecards (user_id, shop_id, entry_date, revenue, gross_profit, car_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, entry_date) DO UPDATE SET
         revenue = excluded.revenue, gross_profit = excluded.gross_profit,
         car_count = excluded.car_count, updated_at = CURRENT_TIMESTAMP`
    ).run(user_id, shop_id ?? null, entry_date, revenue, gross_profit, car_count),
  byUserDate: (userId, date) =>
    decorateAdvisor(db.prepare('SELECT * FROM advisor_scorecards WHERE user_id = ? AND entry_date = ?').get(userId, date)),
  historyForUser: (userId, limit = 30) =>
    db.prepare('SELECT * FROM advisor_scorecards WHERE user_id = ? ORDER BY entry_date DESC LIMIT ?')
      .all(userId, limit).map(decorateAdvisor),
  recentForShop: (shopId, sinceDate) =>
    db.prepare(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
       FROM advisor_scorecards a JOIN users u ON u.id = a.user_id
       WHERE a.shop_id = ? AND a.entry_date >= ? AND u.active = 1
       ORDER BY a.entry_date DESC, u.name`
    ).all(shopId, sinceDate).map(decorateAdvisor),
};

export const ShopScorecards = {
  upsert: ({ shop_id, entered_by, entry_date, total_revenue, gross_profit, tax, cost_of_goods, car_count }) =>
    db.prepare(
      `INSERT INTO shop_scorecards (shop_id, entered_by, entry_date, total_revenue, gross_profit, tax, cost_of_goods, car_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(shop_id, entry_date) DO UPDATE SET
         entered_by = excluded.entered_by, total_revenue = excluded.total_revenue,
         gross_profit = excluded.gross_profit, tax = excluded.tax,
         cost_of_goods = excluded.cost_of_goods, car_count = excluded.car_count,
         updated_at = CURRENT_TIMESTAMP`
    ).run(shop_id, entered_by ?? null, entry_date, total_revenue, gross_profit, tax ?? null, cost_of_goods ?? null, car_count),
  byShopDate: (shopId, date) =>
    decorateShop(db.prepare('SELECT * FROM shop_scorecards WHERE shop_id = ? AND entry_date = ?').get(shopId, date)),
  historyForShop: (shopId, limit = 30) =>
    db.prepare('SELECT * FROM shop_scorecards WHERE shop_id = ? ORDER BY entry_date DESC LIMIT ?')
      .all(shopId, limit).map(decorateShop),
};

// 7 / 30-day trailing averages from a list of rows carrying entry_date +
// revenue/gross_profit/car_count keys. Averages are computed as totals over
// the window (sum revenue / sum cars = true blended ARO, not avg of daily AROs).
export function trends(rows, revKey, gpKey) {
  const out = {};
  for (const days of [7, 30]) {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const win = rows.filter(r => r.entry_date >= since);
    const rev = win.reduce((a, r) => a + r[revKey], 0);
    const gp  = win.reduce((a, r) => a + r[gpKey], 0);
    const cars = win.reduce((a, r) => a + r.car_count, 0);
    out[days] = {
      entries: win.length,
      revenue: round2(rev),
      grossProfit: round2(gp),
      carCount: cars,
      aro: aro(rev, cars),
      gpPct: gpPct(gp, rev),
      avgDailyRevenue: win.length ? round2(rev / win.length) : null,
    };
  }
  return out;
}

// Weekday nudge: on a weekday, was the previous business day's entry made?
// Returns the missing date (YYYY-MM-DD) or null if covered / weekend.
export function missingYesterday(hasEntryForDate) {
  const now = new Date();
  const dow = now.getDay(); // 0 Sun .. 6 Sat
  if (dow === 0 || dow === 6) return null; // weekends: no nudge
  const back = dow === 1 ? 3 : 1;          // Monday looks back to Friday
  const prev = new Date(now.getTime() - back * 86400000).toISOString().slice(0, 10);
  return hasEntryForDate(prev) ? null : prev;
}

// Org rollup for hab_admin admin views: per-shop 7/30-day picture.
export function shopTrend(shopId) {
  const rows = ShopScorecards.historyForShop(shopId, 60);
  return { rows, trends: trends(rows, 'total_revenue', 'gross_profit') };
}
