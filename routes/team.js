// /team — coach/owner view of every advisor's progress in their shop,
// plus manual mastery-level awards. hab_admin can view any shop (?shopId=).
import express from 'express';
import { requireAuth, requireRole } from '../lib/auth.js';
import { Users, Shops, Mastery, MASTERY_LEVELS } from '../lib/db.js';
import { Curriculum } from '../lib/curriculum.js';
import { shopSummary } from '../lib/training.js';

export const teamRouter = express.Router();

function shopContext(req) {
  if (req.session.role === 'hab_admin') {
    return parseInt(req.query.shopId || req.body.shopId, 10) || null;
  }
  return req.session.shopId;
}

teamRouter.get('/team', requireAuth, requireRole('owner', 'coach'), (req, res) => {
  const shopId = shopContext(req);
  if (!shopId) {
    if (req.session.role === 'hab_admin') {
      const shops = Shops.all().map(s => ({ ...s, summary: shopSummary(s.id) }));
      return res.render('team', { user: req.session, summary: null, shops, modules: [], levels: MASTERY_LEVELS, message: null, error: null });
    }
    return res.status(403).render('403', { user: req.session });
  }
  const summary = shopSummary(shopId);
  if (!summary) return res.status(404).render('404');
  res.render('team', {
    user: req.session,
    summary,
    shops: null,
    modules: Curriculum.modules(),
    levels: MASTERY_LEVELS,
    message: req.query.message || null,
    error: req.query.error || null,
  });
});

teamRouter.post('/team/mastery', requireAuth, requireRole('owner', 'coach'), (req, res) => {
  const shopId = shopContext(req);
  const targetId = parseInt(req.body.userId, 10);
  const level = parseInt(req.body.level, 10);
  const note = String(req.body.note || '').trim().slice(0, 280) || null;
  const back = req.session.role === 'hab_admin' && shopId ? `?shopId=${shopId}&` : '?';

  const target = Users.byId(targetId);
  if (!target || !(level >= 1 && level <= 5)) {
    return res.redirect(`/team${back}error=Invalid+user+or+level`);
  }
  // Coaches/owners may only award within their own shop.
  if (req.session.role !== 'hab_admin' && target.shop_id !== req.session.shopId) {
    return res.status(403).render('403', { user: req.session });
  }
  Mastery.award({ userId: targetId, level, awardedBy: req.session.userId, note });
  res.redirect(`/team${back}message=${encodeURIComponent(`${target.name || target.email} promoted to ${MASTERY_LEVELS[level - 1]}`)}`);
});
