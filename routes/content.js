// /dashboard and /content/* — gated file listing & delivery.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth, canSeeCoachContent } from '../lib/auth.js';
import { userSummary } from '../lib/training.js';

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

function listDir(folder) {
  const dir = path.join(CONTENT_ROOT, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.startsWith('.') && !e.name.startsWith('_'))
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
  const advisorFiles = listDir('advisor');
  const managerFiles = canSeeCoachContent(req.session.role) ? listDir('manager') : [];
  res.render('dashboard', {
    user: req.session,
    me: userSummary(req.session.userId),
    advisorFiles,
    managerFiles,
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
