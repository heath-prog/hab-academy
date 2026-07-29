// WP-SIGNUP: agreement-based access enforcement.
// A client shop's users (owner, coach, advisor) only keep platform access
// while the shop has an active, unexpired agreement. Checked on every request
// (a cheap date compare) so expiry is a hard cutoff with no nightly job.
//   - hab_admin is always exempt.
//   - Shops flagged is_demo are exempt (demo/internal shops).
//   - Expired-or-missing agreement: GETs redirect to /agreement-ended,
//     mutations get a 403.
import { Shops, Agreements } from './db.js';

const todayISO = () => new Date().toISOString().slice(0, 10);

// Full access picture for one shop. Auto-expires an active agreement whose
// end date has passed (status flips to 'expired' on first sight).
// Returns { state, shop, agreement, daysRemaining }
//   state: 'demo' | 'active' | 'expired' | 'none' | 'no_shop'
export function shopAccess(shopId) {
  const shop = Shops.byId(shopId);
  if (!shop) return { state: 'no_shop', shop: null, agreement: null, daysRemaining: null };
  if (shop.is_demo) return { state: 'demo', shop, agreement: Agreements.latestForShop(shopId) || null, daysRemaining: null };

  let ag = Agreements.activeForShop(shopId);
  const today = todayISO();
  if (ag && ag.end_date < today) {
    Agreements.markExpired(ag.id); // hard cutoff, recorded
    ag = null;
  }
  if (ag) {
    const days = Math.ceil((Date.parse(ag.end_date) - Date.parse(today)) / 86400000);
    return { state: 'active', shop, agreement: ag, daysRemaining: days };
  }
  const latest = Agreements.latestForShop(shopId);
  return { state: latest ? 'expired' : 'none', shop, agreement: latest || null, daysRemaining: 0 };
}

// Express middleware. Mounted in server.js AFTER auth/signup routes and BEFORE
// all content routes, so login, signup, /agreement-ended and agreement viewing
// stay reachable while everything else is gated.
export function enforceAgreement(req, res, next) {
  const sess = req.session;
  if (!sess?.userId) return next();               // unauthenticated: requireAuth on each route handles it
  if (sess.role === 'hab_admin') return next();   // Heath sees everything, always
  if (!sess.shopId) return next();                // shopless accounts are HAB-internal
  const access = shopAccess(sess.shopId);
  if (access.state === 'demo' || access.state === 'active') return next();
  if (req.method === 'GET') return res.redirect('/agreement-ended');
  return res.status(403).send('Your shop agreement has ended. Contact HAB to renew.');
}
