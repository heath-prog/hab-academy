// /login, /logout, /invite/:token, /set-password, /bootstrap
import express from 'express';
import { Users, Invites, Shops } from '../lib/db.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';

export const authRouter = express.Router();

// ===== LOGIN =====
authRouter.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  res.render('login', {
    error: req.query.error || null,
    message: req.query.message || null,
    next: req.query.next || '/dashboard',
  });
});

authRouter.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const next = req.body.next || '/dashboard';

  const u = Users.byEmail(email);
  if (!u || u.active !== 1 || !u.password_hash) {
    return res.redirect('/login?error=Invalid+email+or+password');
  }
  const ok = await verifyPassword(password, u.password_hash);
  if (!ok) return res.redirect('/login?error=Invalid+email+or+password');

  Users.touchLogin(u.id);

  req.session.regenerate((err) => {
    if (err) {
      console.error('[login] session regenerate error:', err);
      return res.redirect('/login?error=Session+error.+Please+try+again.');
    }
    req.session.userId   = u.id;
    req.session.email    = u.email;
    req.session.role     = u.role;
    req.session.name     = u.name;
    req.session.shopId   = u.shop_id;
    req.session.shopName = u.shop_id ? Shops.byId(u.shop_id)?.name : null;

    req.session.save((err) => {
      if (err) {
        console.error('[login] session save error:', err);
        return res.redirect('/login?error=Session+error.+Please+try+again.');
      }
      res.redirect(typeof next === 'string' && next.startsWith('/') ? next : '/dashboard');
    });
  });
});

// ===== LOGOUT =====
authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login?message=Signed+out.'));
});

// ===== INVITE ACCEPTANCE =====
authRouter.get('/invite/:token', (req, res) => {
  const inv = Invites.byToken(req.params.token);
  if (!inv || inv.used_at || new Date(inv.expires_at) < new Date()) {
    return res.render('invite-bad', { reason: !inv ? 'unknown' : inv.used_at ? 'used' : 'expired' });
  }
  const shop = Shops.byId(inv.shop_id);
  res.render('set-password', {
    token: inv.token,
    email: inv.email,
    role: inv.role,
    shopName: shop?.name || '',
    mode: 'invite',
    error: req.query.error || null,
  });
});

authRouter.post('/invite/:token', async (req, res) => {
  const inv = Invites.byToken(req.params.token);
  if (!inv || inv.used_at || new Date(inv.expires_at) < new Date()) {
    return res.redirect('/login?error=Invite+is+no+longer+valid');
  }
  const password = String(req.body.password || '');
  const confirm  = String(req.body.confirm || '');
  const name     = String(req.body.name || '').trim();
  if (password.length < 8) {
    return res.redirect(`/invite/${inv.token}?error=Password+must+be+at+least+8+characters`);
  }
  if (password !== confirm) {
    return res.redirect(`/invite/${inv.token}?error=Passwords+do+not+match`);
  }

  const hash = await hashPassword(password);
  let existing = Users.byEmail(inv.email);
  let userId;
  if (existing) {
    Users.setPassword(existing.id, hash);
    userId = existing.id;
  } else {
    userId = Users.create({
      email: inv.email,
      password_hash: hash,
      role: inv.role,
      shop_id: inv.shop_id,
      name,
    });
  }
  Invites.consume(inv.token);

  const u = Users.byId(userId);
  req.session.userId = u.id;
  req.session.email  = u.email;
  req.session.role   = u.role;
  req.session.name   = u.name;
  req.session.shopId = u.shop_id;
  req.session.shopName = Shops.byId(u.shop_id)?.name || null;
  res.redirect('/dashboard');
});

// ===== BOOTSTRAP (one-time super-admin password set) =====
authRouter.get('/bootstrap', (req, res) => {
  const u = Users.byEmail((process.env.ADMIN_EMAIL || 'heath@revenuenowinc.com').toLowerCase());
  if (!u) return res.status(404).send('No super-admin seeded. Run `npm run seed`.');
  if (u.password_hash) return res.redirect('/login?message=Already+bootstrapped.+Please+log+in.');
  res.render('set-password', {
    token: null,
    email: u.email,
    role: 'hab_admin',
    shopName: '',
    mode: 'bootstrap',
    error: req.query.error || null,
  });
});

authRouter.post('/bootstrap', async (req, res) => {
  const u = Users.byEmail((process.env.ADMIN_EMAIL || 'heath@revenuenowinc.com').toLowerCase());
  if (!u || u.password_hash) return res.redirect('/login');
  const password = String(req.body.password || '');
  const confirm  = String(req.body.confirm || '');
  const name     = String(req.body.name || '').trim();
  if (password.length < 8) return res.redirect('/bootstrap?error=Password+must+be+at+least+8+characters');
  if (password !== confirm) return res.redirect('/bootstrap?error=Passwords+do+not+match');
  const hash = await hashPassword(password);
  Users.setPassword(u.id, hash);
  if (name) {
    // optional name update via raw query — keep simple
    const db = (await import('../lib/db.js')).default;
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, u.id);
  }
  res.redirect('/login?message=Password+set.+Please+log+in.');
});
