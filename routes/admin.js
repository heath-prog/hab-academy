// /admin/* — Heath (hab_admin) manages shops; shop owners (manager) manage users at their shop.
import express from 'express';
import { Users, Shops, Invites } from '../lib/db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { newInviteToken, newShopCode, expiresIn } from '../lib/tokens.js';
import { sendInviteEmail } from '../lib/mailer.js';

export const adminRouter = express.Router();

// ===== Super-admin: shops =====
adminRouter.get('/shops', requireAuth, requireRole(), (req, res) => {
  if (req.session.role !== 'hab_admin') return res.status(403).render('403', { user: req.session });
  const shops = Shops.all().map(s => ({
    ...s, userCount: Shops.countUsers(s.id),
  }));
  res.render('admin-shops', {
    user: req.session,
    shops,
    message: req.query.message || null,
    error: req.query.error || null,
    invitePreview: req.query.inviteUrl || null,
  });
});

adminRouter.post('/shops', requireAuth, requireRole(), async (req, res) => {
  if (req.session.role !== 'hab_admin') return res.status(403).send('Forbidden.');
  const name = String(req.body.shopName || '').trim();
  const ownerEmail = String(req.body.ownerEmail || '').trim().toLowerCase();
  if (!name || !ownerEmail) return res.redirect('/admin/shops?error=Shop+name+and+owner+email+are+required');

  const code = newShopCode();
  const shopId = Shops.create({ name, code });

  // Create invite for owner as manager
  const token = newInviteToken();
  Invites.create({
    token,
    email: ownerEmail,
    role: 'owner',
    shop_id: shopId,
    invited_by: req.session.userId,
    expires_at: expiresIn(7),
  });

  const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const inviteUrl = `${base}/invite/${token}`;
  const result = await sendInviteEmail({
    to: ownerEmail,
    shopName: name,
    roleLabel: 'shop owner',
    inviteUrl,
    inviterName: req.session.name || 'Heath',
  });

  const msg = result.dev
    ? `Shop+created.+Email+printed+to+server+console+(SMTP+not+configured).`
    : `Shop+created+and+invite+sent+to+${encodeURIComponent(ownerEmail)}.`;
  res.redirect(`/admin/shops?message=${msg}&inviteUrl=${encodeURIComponent(inviteUrl)}`);
});

// ===== Manager: users at their shop =====
adminRouter.get('/users', requireAuth, requireRole('owner', 'coach'), (req, res) => {
  const shopId = req.session.role === 'hab_admin'
    ? (parseInt(req.query.shopId, 10) || null)
    : req.session.shopId;
  if (!shopId) return res.redirect('/admin/shops');

  const shop = Shops.byId(shopId);
  const users = Users.listByShop(shopId);
  const pending = Invites.pendingForShop(shopId);
  res.render('admin-users', {
    user: req.session,
    shop,
    users,
    pending,
    message: req.query.message || null,
    error: req.query.error || null,
    invitePreview: req.query.inviteUrl || null,
  });
});

adminRouter.post('/users/invite', requireAuth, requireRole('owner', 'coach'), async (req, res) => {
  const shopId = req.session.role === 'hab_admin'
    ? (parseInt(req.body.shopId, 10) || null)
    : req.session.shopId;
  if (!shopId) return res.redirect('/admin/shops?error=No+shop+context');

  const email = String(req.body.email || '').trim().toLowerCase();
  const role  = String(req.body.role || '').trim();
  if (!email || !['advisor', 'coach', 'owner'].includes(role)) {
    return res.redirect(`/admin/users?error=Email+and+role+(advisor%2Fcoach%2Fowner)+required${shopId ? `&shopId=${shopId}` : ''}`);
  }

  const token = newInviteToken();
  Invites.create({
    token, email, role,
    shop_id: shopId,
    invited_by: req.session.userId,
    expires_at: expiresIn(7),
  });

  const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const inviteUrl = `${base}/invite/${token}`;
  const shop = Shops.byId(shopId);
  const result = await sendInviteEmail({
    to: email,
    shopName: shop?.name || 'your shop',
    roleLabel: role,
    inviteUrl,
    inviterName: req.session.name || null,
  });

  const msg = result.dev
    ? `Invite+created.+Email+printed+to+server+console+(SMTP+not+configured).`
    : `Invite+sent+to+${encodeURIComponent(email)}.`;
  const sp = req.session.role === 'hab_admin' ? `&shopId=${shopId}` : '';
  res.redirect(`/admin/users?message=${msg}&inviteUrl=${encodeURIComponent(inviteUrl)}${sp}`);
});

adminRouter.post('/users/:id/deactivate', requireAuth, requireRole('owner', 'coach'), (req, res) => {
  const uid = parseInt(req.params.id, 10);
  const u = Users.byId(uid);
  if (!u) return res.redirect('/admin/users?error=User+not+found');
  if (req.session.role !== 'hab_admin' && u.shop_id !== req.session.shopId) {
    return res.status(403).send('Forbidden.');
  }
  if (u.id === req.session.userId) {
    return res.redirect('/admin/users?error=You+cannot+deactivate+yourself');
  }
  Users.deactivate(uid);
  const sp = req.session.role === 'hab_admin' ? `&shopId=${u.shop_id}` : '';
  res.redirect(`/admin/users?message=User+deactivated${sp}`);
});

adminRouter.post('/invites/:id/revoke', requireAuth, requireRole('owner', 'coach'), (req, res) => {
  Invites.revoke(parseInt(req.params.id, 10));
  res.redirect('/admin/users?message=Invite+revoked');
});
