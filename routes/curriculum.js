// /curriculum — the in-app HAB curriculum library + per-section progress.
// WP-ACADEMY-2: each trackable module carries a comprehension check that gates
// its points. Marking a section complete always records progress, but the
// 10 points per section only land once the module's check is passed (>= 80%).
// Passing retroactively grants points for sections completed earlier.
// Retakes are allowed; hab_admin is exempt from the gate.
import express from 'express';
import { requireAuth, canSeeCoachContent } from '../lib/auth.js';
import { Curriculum } from '../lib/curriculum.js';
import { Progress, Points } from '../lib/db.js';
import { POINTS, userSummary } from '../lib/training.js';
import { protectionLocals } from '../lib/protect.js';
import { Checks, sectionPointsUnlocked } from '../lib/checks.js';

export const curriculumRouter = express.Router();

function checkState(req, moduleKey) {
  if (!moduleKey || !Checks.has(moduleKey)) return null;
  return {
    passPct: Checks.passPct,
    passed: Checks.hasPassed(req.session.userId, moduleKey),
    lastAttempt: Checks.lastAttempt(req.session.userId, moduleKey),
    exempt: req.session.role === 'hab_admin',
  };
}

// ===== Library index =====
curriculumRouter.get('/curriculum', requireAuth, (req, res) => {
  const me = userSummary(req.session.userId);
  const coach = canSeeCoachContent(req.session.role);
  const modules = Curriculum.modules().map(m => {
    const done = me.byModule[m.moduleKey] || 0;
    return {
      ...m,
      done,
      pct: m.sectionCount ? Math.round((done / m.sectionCount) * 100) : 0,
      checkPassed: Checks.has(m.moduleKey) ? Checks.hasPassed(req.session.userId, m.moduleKey) : null,
    };
  });
  const refs = Curriculum.refs().filter(r => coach || !r.coachOnly);
  // WP-IP-LOCKDOWN: watermark + print/copy deterrence for client roles.
  res.render('curriculum', { user: req.session, modules, refs, me, ...protectionLocals(req) });
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
    check: checkState(req, ch.moduleKey),
    notice: req.query.notice || null,
    prev: i > 0 ? list[i - 1] : null,
    next: i >= 0 && i < list.length - 1 ? list[i + 1] : null,
    // WP-IP-LOCKDOWN: server-rendered watermark + license line for client roles.
    ...protectionLocals(req),
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
    return res.redirect(`/curriculum/${ch.slug}#s-${section.slug}`);
  }
  Progress.complete(userId, ch.moduleKey, section.slug);
  // WP-ACADEMY-2: points are gated by the module's comprehension check.
  if (sectionPointsUnlocked(userId, req.session.role, ch.moduleKey)) {
    Points.add({ userId, shopId: req.session.shopId, points: POINTS.SECTION, reason: 'section', ref });
    return res.redirect(`/curriculum/${ch.slug}#s-${section.slug}`);
  }
  return res.redirect(`/curriculum/${ch.slug}?notice=check#s-${section.slug}`);
});

// ===== Comprehension check: take =====
curriculumRouter.get('/curriculum/:slug/check', requireAuth, (req, res) => {
  const ch = Curriculum.bySlug(req.params.slug);
  if (!ch || !ch.moduleKey || !Checks.has(ch.moduleKey)) return res.status(404).render('404');
  if (ch.coachOnly && !canSeeCoachContent(req.session.role)) {
    return res.status(403).render('403', { user: req.session });
  }
  res.render('curriculum-check', {
    user: req.session,
    ch,
    questions: Checks.questionsFor(ch.moduleKey),   // never includes answers
    check: checkState(req, ch.moduleKey),
    result: null,
    ...protectionLocals(req, { watermark: false }),
  });
});

// ===== Comprehension check: grade (server-side) =====
curriculumRouter.post('/curriculum/:slug/check', requireAuth, (req, res) => {
  const ch = Curriculum.bySlug(req.params.slug);
  if (!ch || !ch.moduleKey || !Checks.has(ch.moduleKey)) return res.status(404).render('404');
  if (ch.coachOnly && !canSeeCoachContent(req.session.role)) {
    return res.status(403).render('403', { user: req.session });
  }
  const questions = Checks.questionsFor(ch.moduleKey);
  const answers = questions.map((q, i) => {
    const v = parseInt(req.body[`q${i}`], 10);
    return Number.isInteger(v) ? v : -1;
  });
  const result = Checks.grade(req.session.userId, req.session.shopId, ch.moduleKey, answers);
  res.render('curriculum-check', {
    user: req.session,
    ch,
    questions,
    check: checkState(req, ch.moduleKey),
    result,
    ...protectionLocals(req, { watermark: false }),
  });
});
