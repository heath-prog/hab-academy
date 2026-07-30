// WP-ACADEMY-2: /scorecard — daily KPI entry + history + trends, and
// /insights — the owner-only reading view (see lib/engagement.js).
//
// Scorecard doctrine: owning your numbers daily is a coaching tactic. The
// entry is deliberately tiny (three or five fields) so it takes under a
// minute; ARO and GP% are computed, never typed.
//
// Edit rules: an entry can be corrected for EDIT_WINDOW_DAYS days after its
// entry date, then locks. hab_admin can always edit (client restrictions
// never apply to hab_admin).
import express from 'express';
import { requireAuth, requireRole } from '../lib/auth.js';
import { Shops } from '../lib/db.js';
import {
  AdvisorScorecards, ShopScorecards, trends, isEditable, EDIT_WINDOW_DAYS,
} from '../lib/scorecards.js';
import { shopEngagement, allShopsEngagement } from '../lib/engagement.js';

export const scorecardsRouter = express.Router();

const todayISO = () => new Date().toISOString().slice(0, 10);
const isLeader = (role) => ['owner', 'coach', 'hab_admin'].includes(role);

function parseMoney(v) {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
function parseCount(v) {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function parseDate(v) {
  const d = String(v || '').trim() || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (d > todayISO()) return null; // no future entries
  return d;
}

// ===== Scorecard home: entry forms + history + trends =====
scorecardsRouter.get('/scorecard', requireAuth, requireRole('advisor', 'coach', 'owner'), (req, res) => {
  let shopId = req.session.shopId;
  if (req.session.role === 'hab_admin') {
    shopId = parseInt(req.query.shopId, 10) || shopId;
    if (!shopId) return res.redirect('/admin/scorecards');
  }

  const myRows = AdvisorScorecards.historyForUser(req.session.userId, 30);
  const my = {
    rows: myRows,
    trends: trends(myRows, 'revenue', 'gross_profit'),
    today: AdvisorScorecards.byUserDate(req.session.userId, todayISO()),
  };

  let shopCard = null;
  if (shopId && isLeader(req.session.role)) {
    const rows = ShopScorecards.historyForShop(shopId, 30);
    shopCard = {
      shop: Shops.byId(shopId),
      rows,
      trends: trends(rows, 'total_revenue', 'gross_profit'),
      today: ShopScorecards.byShopDate(shopId, todayISO()),
      advisorRows: AdvisorScorecards.recentForShop(shopId, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
    };
  }

  res.render('scorecard', {
    user: req.session,
    my,
    shopCard,
    today: todayISO(),
    editWindowDays: EDIT_WINDOW_DAYS,
    isEditable: (d) => isEditable(d, req.session.role),
    message: req.query.message || null,
    error: req.query.error || null,
  });
});

// ===== Personal (advisor) daily entry =====
scorecardsRouter.post('/scorecard/advisor', requireAuth, requireRole('advisor', 'coach', 'owner'), (req, res) => {
  const back = (q) => res.redirect(`/scorecard?${q}`);
  const entryDate = parseDate(req.body.entryDate);
  const revenue = parseMoney(req.body.revenue);
  const grossProfit = parseMoney(req.body.grossProfit);
  const carCount = parseCount(req.body.carCount);
  if (!entryDate) return back('error=' + encodeURIComponent('Pick a valid date (no future dates)'));
  if (revenue === null || grossProfit === null || carCount === null) {
    return back('error=' + encodeURIComponent('Revenue, gross profit and car count are required numbers'));
  }
  if (!isEditable(entryDate, req.session.role)) {
    return back('error=' + encodeURIComponent(`Entries lock ${EDIT_WINDOW_DAYS} days after their date. Ask HAB to correct this one.`));
  }
  AdvisorScorecards.upsert({
    user_id: req.session.userId, shop_id: req.session.shopId,
    entry_date: entryDate, revenue, gross_profit: grossProfit, car_count: carCount,
  });
  return back('message=' + encodeURIComponent(`Saved your numbers for ${entryDate}. Own the scoreboard.`));
});

// ===== Shop daily entry (owner / coach; hab_admin any shop) =====
scorecardsRouter.post('/scorecard/shop', requireAuth, requireRole('owner', 'coach'), (req, res) => {
  const shopId = req.session.role === 'hab_admin'
    ? (parseInt(req.body.shopId, 10) || null)
    : req.session.shopId;
  const back = (q) => res.redirect(`/scorecard?${req.session.role === 'hab_admin' && shopId ? `shopId=${shopId}&` : ''}${q}`);
  if (!shopId) return res.status(403).send('No shop context.');

  const entryDate = parseDate(req.body.entryDate);
  const totalRevenue = parseMoney(req.body.totalRevenue);
  const grossProfit = parseMoney(req.body.grossProfit);
  const carCount = parseCount(req.body.carCount);
  const tax = String(req.body.tax || '').trim() === '' ? null : parseMoney(req.body.tax);
  const cogs = String(req.body.costOfGoods || '').trim() === '' ? null : parseMoney(req.body.costOfGoods);
  if (!entryDate) return back('error=' + encodeURIComponent('Pick a valid date (no future dates)'));
  if (totalRevenue === null || grossProfit === null || carCount === null) {
    return back('error=' + encodeURIComponent('Total revenue, gross profit and car count are required numbers'));
  }
  if (!isEditable(entryDate, req.session.role)) {
    return back('error=' + encodeURIComponent(`Entries lock ${EDIT_WINDOW_DAYS} days after their date. Ask HAB to correct this one.`));
  }
  ShopScorecards.upsert({
    shop_id: shopId, entered_by: req.session.userId, entry_date: entryDate,
    total_revenue: totalRevenue, gross_profit: grossProfit,
    tax, cost_of_goods: cogs, car_count: carCount,
  });
  return back('message=' + encodeURIComponent(`Shop numbers saved for ${entryDate}.`));
});

// ===== Owner reading view (per-user time on the material) =====
// Owners only (plus hab_admin, who can see any shop or the all-shops list).
// Coaches and advisors have no route, no nav entry, and no rendered reference.
scorecardsRouter.get('/insights', requireAuth, requireRole('owner'), (req, res) => {
  let shopId = req.session.shopId;
  let shopsOverview = null;
  if (req.session.role === 'hab_admin') {
    shopId = parseInt(req.query.shopId, 10) || null;
    if (!shopId) shopsOverview = allShopsEngagement();
  }
  const shop = shopId ? Shops.byId(shopId) : null;
  res.render('insights', {
    user: req.session,
    shop,
    people: shopId ? shopEngagement(shopId) : null,
    shopsOverview,
  });
});
