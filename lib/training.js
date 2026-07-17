// Shared training math — used by /team, /leaderboard, the dashboard and the
// /api/shops/:id/training-summary attribution endpoint.
import { Users, Shops, Progress, Points, Checkins, Mastery, MASTERY_LEVELS } from './db.js';
import { Curriculum } from './curriculum.js';

export const POINTS = {
  SECTION: 10,                                  // per completed curriculum section
  CHECKIN: 5,                                   // per daily Take-Five check-in
  streakBonus: (streak) => Math.min(Math.max(streak - 1, 0), 10), // consecutive-day bonus, capped
};

const pct = (done, total) => (total ? Math.round((done / total) * 100) : 0);

// Per-user rollup (any role — coaches train too).
export function userSummary(userId) {
  const total = Curriculum.totalSections();
  const byModule = Progress.countsByModuleForUser(userId);
  const done = Object.values(byModule).reduce((a, b) => a + b, 0);
  const level = Mastery.currentLevel(userId);
  return {
    byModule,
    sectionsCompleted: done,
    sectionsTotal: total,
    pctComplete: pct(done, total),
    points: Points.totalForUser(userId),
    streak: Checkins.streakForUser(userId),
    checkedInToday: !!Checkins.today(userId),
    masteryLevel: level,
    masteryName: MASTERY_LEVELS[level - 1],
  };
}

// Full shop rollup. Includes every active user attached to the shop;
// `advisors` filter keeps the attribution number honest (training % = advisors only).
export function shopSummary(shopId) {
  const shop = Shops.byId(shopId);
  if (!shop) return null;
  const users = Users.activeByShop(shopId);
  const matrix = Progress.matrixForShop(shopId);      // user_id, module_key, c
  const points = Points.totalsForShop(shopId);
  const levels = Mastery.levelsForShop(shopId);
  const modules = Curriculum.modules();               // [{moduleKey, title, sectionCount}...]
  const totalSections = Curriculum.totalSections();

  const byUser = {};
  for (const r of matrix) {
    (byUser[r.user_id] ||= {})[r.module_key] = r.c;
  }

  const members = users.map(u => {
    const perModule = byUser[u.id] || {};
    const done = Object.values(perModule).reduce((a, b) => a + b, 0);
    const level = levels[u.id] || 1;
    return {
      id: u.id, name: u.name, email: u.email, role: u.role,
      perModule,
      sectionsCompleted: done,
      sectionsTotal: totalSections,
      pctComplete: pct(done, totalSections),
      points: points[u.id] || 0,
      streak: Checkins.streakForUser(u.id),
      masteryLevel: level,
      masteryName: MASTERY_LEVELS[level - 1],
    };
  });

  const advisors = members.filter(m => m.role === 'advisor');
  const pool = advisors.length ? advisors : members;  // solo-owner shops still get a number
  const shopPct = pct(
    pool.reduce((a, m) => a + m.sectionsCompleted, 0),
    pool.length * totalSections
  );

  const moduleRollup = modules.map(m => {
    const done = pool.reduce((a, u) => a + (u.perModule[m.moduleKey] || 0), 0);
    return {
      key: m.moduleKey, title: m.title, sections: m.sectionCount,
      pctComplete: pct(done, pool.length * m.sectionCount),
    };
  });

  return {
    shopId: shop.id, shopCode: shop.code, shopName: shop.name,
    totalSections,
    advisorCount: advisors.length,
    memberCount: members.length,
    pctComplete: shopPct,
    modules: moduleRollup,
    members,
  };
}
