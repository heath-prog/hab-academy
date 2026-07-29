// /dashboard and /content/* — gated file listing & delivery.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth, canSeeCoachContent } from '../lib/auth.js';
import { userSummary } from '../lib/training.js';
import { Shops, Agreements, PendingMembers } from '../lib/db.js';
import { shopAccess } from '../lib/access.js';
import { TIERS } from '../lib/agreements.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = path.join(__dirname, '..', 'content');

export const contentRouter = express.Router();

// Pretty labels for known extensions
const ICONS = {
  '.pdf':  '📄',
  '.html': '🌐',
  '.htm':  '🌐',
  '.pptx': '🎬',
  '.docx': '📝',
  '.xlsx': '📊',
};

// WP-SIGNUP lockdown: the printable book PDFs that live in content/ (Advisor
// Book, Script Book, Coach's Book) are hab_admin-only, same as /library PDFs.
// Non-book reference PDFs (one-pagers, posters, worksheets) stay available.
const isBookPdf = (name) =>
  path.extname(name).toLowerCase() === '.pdf' && /book/i.test(name);

function listDir(folder, { includeBookPdfs = false } = {}) {
  const dir = path.join(CONTENT_ROOT, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.startsWith('.') && !e.name.startsWith('_'))
    .filter(e => includeBookPdfs || !isBookPdf(e.name))
    .map(e => {
      const ext = path.extname(e.name).toLowerCase();
      const stat = fs.statSync(path.join(dir, e.name));
      return {
        name: e.name,
        prettyName: e.name.replace(/[_-]/g, ' ').replace(/\.[^.]+$/, ''),
        size: stat.size,
        ext,
        icon: ICONS[ext] || '📁',
        url: `/content/${folder}/${encodeURIComponent(e.name)}`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ===== Dashboard =====
contentRouter.get('/dashboard', requireAuth, (req, res) => {
  const isAdmin = req.session.role === 'hab_admin';
  const advisorFiles = listDir('advisor', { includeBookPdfs: isAdmin });
  const managerFiles = canSeeCoachContent(req.session.role)
    ? listDir('manager', { includeBookPdfs: isAdmin })
    : [];

  // WP-SIGNUP: owner panel — join code, agreement status, pending approvals.
  let ownerPanel = null;
  if (req.session.role === 'owner' && req.session.shopId) {
    const access = shopAccess(req.session.shopId);
    const ag = access.agreement;
    ownerPanel = {
      shop: access.shop,
      joinCode: access.shop?.join_code || null,
      access,
      tierLabel: ag ? (TIERS[ag.tier]?.label || ag.tier) : null,
      agreement: ag,
      pendingMembers: PendingMembers.pendingForShop(req.session.shopId),
    };
  }

  res.render('dashboard', {
    user: req.session,
    me: userSummary(req.session.userId),
    advisorFiles,
    managerFiles,
    ownerPanel,
    message: req.query.message || null,
    error: req.query.error || null,
  });
});

// ===== Gated content delivery =====
contentRouter.get('/content/:tier/:filename', requireAuth, (req, res) => {
  const tier = req.params.tier;
  if (!['advisor', 'manager'].includes(tier)) return res.status(404).send('Not found.');
  if (tier === 'manager' && !canSeeCoachContent(req.session.role)) {
    return res.status(403).render('403', { user: req.session });
  }
  // Path traversal guard
  const safeName = path.basename(req.params.filename);
  // WP-SIGNUP lockdown: printable book PDFs are hab_admin-only.
  if (isBookPdf(safeName) && req.session.role !== 'hab_admin') {
    return res.status(403).render('403', { user: req.session });
  }
  const full = path.join(CONTENT_ROOT, tier, safeName);
  if (!fs.existsSync(full)) return res.status(404).send('File not found.');

  // Inline display for things browsers can render; attachment for binaries
  const ext = path.extname(safeName).toLowerCase();
  const inline = ['.pdf', '.html', '.htm', '.png', '.jpg', '.jpeg', '.gif', '.svg'];
  if (inline.includes(ext)) {
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  }
  res.sendFile(full);
});
