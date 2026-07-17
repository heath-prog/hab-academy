// JSON API — training attribution for the machine-asset-manager portfolio
// integration (see CRM_DATA_MODEL.md). Session-authenticated:
//   hab_admin  → any shop
//   owner/coach → their own shop only
import express from 'express';
import { shopSummary } from '../lib/training.js';

export const apiRouter = express.Router();

function requireApiAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

apiRouter.get('/shops/:id/training-summary', requireApiAuth, (req, res) => {
  const shopId = parseInt(req.params.id, 10);
  const role = req.session.role;
  const allowed = role === 'hab_admin' || (['owner', 'coach'].includes(role) && req.session.shopId === shopId);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });

  const s = shopSummary(shopId);
  if (!s) return res.status(404).json({ error: 'shop_not_found' });

  res.json({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    shop: { id: s.shopId, code: s.shopCode, name: s.shopName },
    training: {
      pctComplete: s.pctComplete,          // advisors only — the attribution number
      advisorCount: s.advisorCount,
      totalSections: s.totalSections,
      modules: s.modules,                  // [{key, title, sections, pctComplete}]
    },
    advisors: s.members.map(m => ({
      id: m.id, name: m.name, email: m.email, role: m.role,
      pctComplete: m.pctComplete,
      sectionsCompleted: m.sectionsCompleted,
      points: m.points,
      streak: m.streak,
      masteryLevel: m.masteryLevel,
      masteryName: m.masteryName,
      perModule: m.perModule,
    })),
  });
});
