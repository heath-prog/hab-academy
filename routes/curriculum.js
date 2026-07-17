// /curriculum — the in-app HAB curriculum library + per-section progress.
import express from 'express';
import { requireAuth, canSeeCoachContent } from '../lib/auth.js';
import { Curriculum } from '../lib/curriculum.js';
import { Progress, Points } from '../lib/db.js';
import { POINTS, userSummary } from '../lib/training.js';

export const curriculumRouter = express.Router();

// ===== Library index =====
curriculumRouter.get('/curriculum', requireAuth, (req, res) => {
  const me = userSummary(req.session.userId);
  const coach = canSeeCoachContent(req.session.role);
  const modules = Curriculum.modules().map(m => {
    const done = me.byModule[m.moduleKey] || 0;
    return { ...m, done, pct: m.sectionCount ? Math.round((done / m.sectionCount) * 100) : 0 };
  });
  const refs = Curriculum.refs().filter(r => coach || !r.coachOnly);
  res.render('curriculum', { user: req.session, modules, refs, me });
});

// ===== Chapter view =====
curriculumRouter.get('/curriculum/:slug', requireAuth, (req, res) => {
  const ch = Curriculum.bySlug(req.params.slug);
  if (!ch) return res.status(404).render('404');
  if (ch.coachOnly && !canSeeCoachContent(req.session.role)) {
    return res.status(403).render('403', { user: req.session });
  }
  const doneSlugs = ch.moduleKey
    ? new Set(Progress.slugsForUserModule(req.session.userId, ch.moduleKey))
    : new Set();

  // prev/next in book order, hiding coach-only chapters from advisors
  const coach = canSeeCoachContent(req.session.role);
  const list = Curriculum.chapters().filter(c => coach || !c.coachOnly);
  const i = list.findIndex(c => c.slug === ch.slug);
  res.render('curriculum-chapter', {
    user: req.session,
    ch,
    doneSlugs,
    prev: i > 0 ? list[i - 1] : null,
    next: i >= 0 && i < list.length - 1 ? list[i + 1] : null,
  });
});

// ===== Mark section complete / not complete =====
curriculumRouter.post('/curriculum/:slug/sections/:section/toggle', requireAuth, (req, res) => {
  const ch = Curriculum.bySlug(req.params.slug);
  if (!ch || !ch.moduleKey) return res.status(404).send('Not a trackable module.');
  const section = ch.sections.find(s => s.slug === req.params.section);
  if (!section) return res.status(404).send('Unknown section.');

  const userId = req.session.userId;
  const ref = `${ch.moduleKey}:${section.slug}`;
  const already = Progress.slugsForUserModule(userId, ch.moduleKey).includes(section.slug);
  if (already) {
    Progress.uncomplete(userId, ch.moduleKey, section.slug);
    Points.removeByRef(userId, 'section', ref);
  } else {
    Progress.complete(userId, ch.moduleKey, section.slug);
    Points.add({ userId, shopId: req.session.shopId, points: POINTS.SECTION, reason: 'section', ref });
  }
  res.redirect(`/curriculum/${ch.slug}#s-${section.slug}`);
});
