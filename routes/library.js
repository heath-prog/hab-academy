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
import { protectionLocals, injectProtection } from '../lib/protect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.join(__dirname, '..', 'content', 'books');

// Registry of in-app books. coachOnly books are for owners/GMs/Champions being
// developed into coaches — advisors never see them listed and get a 403 on
// direct access.
export const BOOKS = [
  {
    slug: 'advisor-book',
    file: 'HAB_Advisor_Book_v2.9.html',
    pdf: 'HAB_Advisor_Book_v2.9.pdf',
    title: 'HAB Advisor Book',
    subtitle: 'The Sales OS for Service Advisors',
    version: 'v2.9',
    updated: '2026-07-25',
    coachOnly: false,
    blurb: 'The complete standalone edition — Foundation, Modules 1–9 with full scripts, all 9 Boss Battles (including Boss 9: The Second Opinion), L.A.S.T., the Worked-Example Library, Glossary, KPIs and Mastery Tracker. v2.9 adds the new Tone & Status chapter ("The Posture of a Professional"): servant-not-subordinate status, the Status Shrinking anti-pattern, why rapport and credibility earn the right to shoot straight, and Stage vs Counter delivery for inspection videos. Includes the no-pre-education phone doctrine, the Keys Moment, DVI timing, and the Short Stop play. Print-ready US Letter.',
  },
  {
    slug: 'script-book',
    file: 'HAB_Script_Book_v3.7.html',
    pdf: 'HAB_Script_Book_v3.7.pdf',
    title: 'HAB Script Book',
    subtitle: 'Clean Scripts for Roleplay & Memorization',
    version: 'v3.7',
    updated: '2026-07-23',
    coachOnly: false,
    blurb: 'Scripts only — no psychology, no callouts, no interruptions. Every script with labeled speakers, one per page: the full inbound call opening with the "When Is Now a Good Time" Quick Close, the tour, the Keys Moment, PRS, the 10-step ISO, all 9 Boss Battles (including Boss 9: The Second Opinion with the Short Stop and the Repair Plan), L.A.S.T. recovery, the reassurance-first 2nd/3rd-base calls, and booking the next visit. Built for morning roleplay and memorization reps.',
  },
  {
    slug: 'coachs-book',
    file: 'HAB_Coachs_Book_v2.2.html',
    pdf: 'HAB_Coachs_Book_v2.2.pdf',
    title: "HAB Coach's Book",
    subtitle: "The Manager's Operating Manual",
    version: 'v2.2',
    updated: '2026-07-25',
    coachOnly: true,
    blurb: 'The coaching layer — six principles, SBI, the Five-Beat conversation, coaching rhythm, KPI red-flag diagnosis, ride-along scorecards, mastery promotion checks, the 13-week Coach Certification cycle and 90-day rollout. v2.2 adds Ch 3.5 "Coaching Tone & Status": the status-leak audit, tone-rep drills (Just Jar, Back-Row Reps), the weekly video-energy review, plus audit lenses for phone no-pre-education, DVI timing, the Keys Moment, reassurance opens, and Short Stop reinforcement.',
  },
];

export const libraryRouter = express.Router();

// ===== Library index (in-app layout) =====
libraryRouter.get('/library', requireAuth, (req, res) => {
  const coach = canSeeCoachContent(req.session.role);
  const books = BOOKS
    .filter(b => coach || !b.coachOnly)
    .map(b => ({ ...b, available: fs.existsSync(path.join(BOOKS_DIR, b.file)) }));
  res.render('library', {
    user: req.session,
    books,
    coach,
    // WP-SIGNUP lockdown: printable PDF editions are hab_admin-only. Clients
    // read in the browser and order printed copies instead.
    canDownloadPdf: req.session.role === 'hab_admin',
    // WP-IP-LOCKDOWN: print/copy deterrence on the index (no watermark here;
    // the readers themselves carry it).
    ...protectionLocals(req, { watermark: false }),
  });
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
  // WP-IP-LOCKDOWN: for client roles the book ships with the protection layer
  // injected server-side — dynamic watermark (name + email), print-blocking
  // CSS, copy deterrence, license line. hab_admin gets the clean file.
  // Screenshots cannot be blocked in a browser; the watermark is the deterrent.
  if (req.session.role !== 'hab_admin') {
    const html = fs.readFileSync(full, 'utf8');
    let out = injectProtection(html, req);
    // WP-ACADEMY-2: reading beat (30s visible-page ping, see public/hb.js).
    const hbTag = `<script src="/hb.js" data-k="book:${book.slug}" defer></script>`;
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${hbTag}\n</body>`) : out + hbTag;
    return res.send(out);
  }
  res.sendFile(full);
});

// ===== PDF edition delivery — hab_admin ONLY (WP-SIGNUP lockdown) =====
// Client roles never get the printable book files: in-browser reading stays
// open while the agreement is active, and printed copies are ordered at
// /orders. Only Heath can pull the PDFs (for fulfillment/printing).
libraryRouter.get('/library/:slug/pdf', requireAuth, (req, res) => {
  const book = BOOKS.find(b => b.slug === req.params.slug);
  if (!book || !book.pdf) return res.status(404).render('404');
  if (req.session.role !== 'hab_admin') {
    return res.status(403).render('403', { user: req.session });
  }
  const full = path.join(BOOKS_DIR, path.basename(book.pdf));
  if (!fs.existsSync(full)) return res.status(404).send('PDF not found.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${book.pdf}"`);
  res.sendFile(full);
});
