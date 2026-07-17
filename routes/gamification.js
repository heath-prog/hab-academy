// Take-Five daily check-in + shop leaderboard.
import express from 'express';
import { requireAuth } from '../lib/auth.js';
import { Points, Checkins, Shops } from '../lib/db.js';
import { POINTS, shopSummary } from '../lib/training.js';

export const gamificationRouter = express.Router();

// ===== Daily Take-Five check-in =====
gamificationRouter.post('/checkin', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const note = String(req.body.note || '').trim().slice(0, 280) || null;
  const created = Checkins.add(userId, note);
  if (created) {
    const streak = Checkins.streakForUser(userId);
    const pts = POINTS.CHECKIN + POINTS.streakBonus(streak);
    Points.add({
      userId, shopId: req.session.shopId,
      points: pts, reason: 'checkin',
      ref: new Date().toISOString().slice(0, 10),
    });
  }
  res.redirect(req.body.back === 'leaderboard' ? '/leaderboard' : '/dashboard');
});

// ===== Shop leaderboard =====
gamificationRouter.get('/leaderboard', requireAuth, (req, res) => {
  let shopId = req.session.shopId;
  if (req.session.role === 'hab_admin') {
    shopId = parseInt(req.query.shopId, 10) || shopId;
    if (!shopId) {
      // No shop context: give Heath a shop picker.
      const shops = Shops.all().map(s => ({ ...s, summary: shopSummary(s.id) }));
      return res.render('leaderboard', { user: req.session, summary: null, shops });
    }
  }
  if (!shopId) return res.status(403).render('403', { user: req.session });
  const summary = shopSummary(shopId);
  if (!summary) return res.status(404).render('404');
  summary.members.sort((a, b) => b.points - a.points || b.pctComplete - a.pctComplete);
  res.render('leaderboard', { user: req.session, summary, shops: null });
});
