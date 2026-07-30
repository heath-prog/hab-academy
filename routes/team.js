// /team — coach/owner view of every advisor's progress in their shop,
// plus manual mastery-level awards. hab_admin can view any shop (?shopId=).
import express from 'express';
import { requireAuth, requireRole } from '../lib/auth.js';
import { Users, Shops, Mastery, MASTERY_LEVELS, PendingMembers } from '../lib/db.js';
import { Curriculum } from '../lib/curriculum.js';
import { shopSummary } from '../lib/training.js';
import { sendPromotionEmail, sendWelcomeEmail } from '../lib/mailer.js';
import { emitMemberJoined } from '../lib/sync.js';

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

teamRouter.post('/team/mastery', requireAuth, requireRole('owner', 'coach'), async (req, res) => {
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
  const previousLevel = Mastery.currentLevel(targetId);
  Mastery.award({ userId: targetId, level, awardedBy: req.session.userId, note });

  // WP-SIGNUP: notify the user when their mastery level actually changes
  // (email if GMAIL creds are configured, console log otherwise).
  if (level !== previousLevel) {
    try {
      await sendPromotionEmail({
        to: target.email,
        name: target.name,
        levelName: MASTERY_LEVELS[level - 1],
        level,
        shopName: Shops.byId(target.shop_id)?.name || 'your shop',
        awardedBy: req.session.name || null,
      });
    } catch (e) { console.error('[team] promotion email failed:', e.message); }
  }
  res.redirect(`/team${back}message=${encodeURIComponent(`${target.name || target.email} promoted to ${MASTERY_LEVELS[level - 1]}`)}`);
});

// ===== WP-SIGNUP: owner approval of coach/owner self-signups =====
// Advisors and technicians join instantly via the shop join code; coach and
// additional owner accounts wait here until the owner approves or denies them
// from the dashboard.
function loadPending(req, res) {
  const pm = PendingMembers.byId(parseInt(req.params.id, 10));
  if (!pm || pm.status !== 'pending') {
    res.redirect('/dashboard?error=That+signup+request+is+no+longer+pending');
    return null;
  }
  if (req.session.role !== 'hab_admin' && pm.shop_id !== req.session.shopId) {
    res.status(403).render('403', { user: req.session });
    return null;
  }
  return pm;
}

teamRouter.post('/team/pending/:id/approve', requireAuth, requireRole('owner'), async (req, res) => {
  const pm = loadPending(req, res);
  if (!pm) return;
  if (Users.byEmail(pm.email)) {
    PendingMembers.decide(pm.id, 'denied', req.session.userId);
    return res.redirect('/dashboard?error=An+account+with+that+email+already+exists');
  }
  Users.create({
    email: pm.email, password_hash: pm.password_hash,
    role: pm.role, shop_id: pm.shop_id, name: pm.name,
  });
  PendingMembers.decide(pm.id, 'approved', req.session.userId);
  const shop = Shops.byId(pm.shop_id);
  // WP-ACADEMY-2: platform sync (queued, non-blocking).
  emitMemberJoined({ shop_name: shop?.name || 'Unknown shop', name: pm.name, email: pm.email, role: pm.role });
  try {
    const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    await sendWelcomeEmail({
      to: pm.email, name: pm.name, shopName: shop?.name || 'your shop',
      roleLabel: pm.role === 'coach' ? 'coach' : 'owner',
      loginUrl: `${base}/login`,
    });
  } catch (e) { console.error('[team] approval welcome email failed:', e.message); }
  res.redirect(`/dashboard?message=${encodeURIComponent(`${pm.name} approved as ${pm.role}. They can sign in now.`)}`);
});

teamRouter.post('/team/pending/:id/deny', requireAuth, requireRole('owner'), (req, res) => {
  const pm = loadPending(req, res);
  if (!pm) return;
  PendingMembers.decide(pm.id, 'denied', req.session.userId);
  res.redirect(`/dashboard?message=${encodeURIComponent(`${pm.name}'s request was denied.`)}`);
});
