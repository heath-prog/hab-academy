// /library — the HAB book library (full standalone editions of the v2 books).
// Mirrors the content/ pattern: files live under content/books/, delivery is
// auth-gated, and coach-tier books are hidden from advisors entirely.
// Books are served as styled standalone pages (their internal CSS is preserved),
// linked from the in-layout /library index.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth, canSeeCoachContent } from '../lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.join(__dirname, '..', 'content', 'books');

// Registry of in-app books. coachOnly books are for owners/GMs/Champions being
// developed into coaches — advisors never see them listed and get a 403 on
// direct access.
export const BOOKS = [
  {
    slug: 'advisor-book',
    file: 'HAB_Advisor_Book_v2.html',
    title: 'HAB Advisor Book',
    subtitle: 'The Sales OS for Service Advisors',
    version: 'v2.0',
    updated: '2026-07-16',
    coachOnly: false,
    blurb: 'The complete standalone edition — Foundation, Modules 1–9 with full scripts, all 8 Boss Battles, L.A.S.T., the Worked-Example Library, Glossary, KPIs and Mastery Tracker. Print-ready US Letter.',
  },
  {
    slug: 'coachs-book',
    file: 'HAB_Coachs_Book_v2.html',
    title: "HAB Coach's Book",
    subtitle: "The Manager's Operating Manual",
    version: 'v2.0',
    updated: '2026-07-16',
    coachOnly: true,
    blurb: 'The coaching layer — six principles, SBI, the Five-Beat conversation, coaching rhythm, KPI red-flag diagnosis, ride-along scorecards, mastery promotion checks, the 13-week Coach Certification cycle and 90-day rollout.',
  },
];

export const libraryRouter = express.Router();

// ===== Library index (in-app layout) =====
libraryRouter.get('/library', requireAuth, (req, res) => {
  const coach = canSeeCoachContent(req.session.role);
  const books = BOOKS
    .filter(b => coach || !b.coachOnly)
    .map(b => ({ ...b, available: fs.existsSync(path.join(BOOKS_DIR, b.file)) }));
  res.render('library', { user: req.session, books, coach });
});

// ===== Book delivery (styled standalone page, internal CSS preserved) =====
libraryRouter.get('/library/:slug', requireAuth, (req, res) => {
  const book = BOOKS.find(b => b.slug === req.params.slug);
  if (!book) return res.status(404).render('404');
  if (book.coachOnly && !canSeeCoachContent(req.session.role)) {
    return res.status(403).render('403', { user: req.session });
  }
  const full = path.join(BOOKS_DIR, path.basename(book.file));
  if (!fs.existsSync(full)) return res.status(404).send('Book file not found.');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${book.file}"`);
  res.sendFile(full);
});
