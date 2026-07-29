// WP-ORG v1 — progress rollups for the hab_admin oversight dashboard.
// Rollup math (MSO model: Organizational Unit -> Shops -> Users):
//   user %  = completed curriculum sections / total sections (lib/training.js userSummary)
//   shop %  = plain average of its active users' user % (0% when a shop has no users)
//   org %   = plain average of its shops' shop % (0% when an org has no shops)
// Each user's "contribution" is the percentage points they add to the shop
// average (user % / user count), so the shop number is auditable per person.
import { OrgUnits, Shops, Users } from './db.js';
import { userSummary } from './training.js';

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export function shopRollup(shopId) {
  const shop = Shops.byId(shopId);
  if (!shop) return null;
  const members = Users.activeByShop(shopId).map((u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role,
    ...userSummary(u.id),
  }));
  const pctRaw = avg(members.map((m) => m.pctComplete));
  return {
    id: shop.id,
    name: shop.name,
    code: shop.code,
    orgUnitId: shop.org_unit_id,
    userCount: members.length,
    pctRaw,                              // unrounded, for the org-level average
    pctComplete: Math.round(pctRaw),
    checkedInToday: members.filter((m) => m.checkedInToday).length,
    bestStreak: members.reduce((a, m) => Math.max(a, m.streak), 0),
    totalPoints: members.reduce((a, m) => a + m.points, 0),
    members: members.map((m) => ({
      ...m,
      contribution: members.length
        ? Math.round((m.pctComplete / members.length) * 10) / 10
        : 0,
    })),
  };
}

export function orgRollup(orgId) {
  const org = OrgUnits.byId(orgId);
  if (!org) return null;
  const shops = OrgUnits.shopsFor(orgId).map((s) => shopRollup(s.id));
  const pctRaw = avg(shops.map((s) => s.pctRaw));
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    shopCount: shops.length,
    userCount: shops.reduce((a, s) => a + s.userCount, 0),
    pctComplete: Math.round(pctRaw),
    checkedInToday: shops.reduce((a, s) => a + s.checkedInToday, 0),
    bestStreak: shops.reduce((a, s) => Math.max(a, s.bestStreak), 0),
    totalPoints: shops.reduce((a, s) => a + s.totalPoints, 0),
    shops,
  };
}

// Portfolio: every org unit rolled up, for /admin.
export function portfolioRollup() {
  return OrgUnits.all().map((o) => orgRollup(o.id));
}
