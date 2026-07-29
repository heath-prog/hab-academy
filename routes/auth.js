// /login, /logout, /invite/:token, /set-password, /bootstrap,
// /forgot-password, /reset-password/:token
import express from 'express';
import { Users, Invites, Shops, PasswordResets } from '../lib/db.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import { newResetToken, sha256, expiresInHours } from '../lib/tokens.js';
import { sendPasswordResetEmail } from '../lib/mailer.js';
import { rememberResetLink, forgetResetLink } from '../lib/reset-links.js';
import { ADMIN_EMAIL } from '../lib/seed-admin.js';

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

// ===== BOOTSTRAP (first-run super-admin claim) =====
// Only meaningful while the admin account has no password. Once the admin
// has a password (the normal case — boot auto-seeds one), send people to
// /forgot-password instead.
// PRODUCTION RULE: /bootstrap must not exist in production once the admin is
// set up. It 404s unless the admin account is genuinely unclaimed.
function bootstrapDisabled() {
  const u = Users.byEmail(ADMIN_EMAIL);
  return process.env.NODE_ENV === 'production' && u && u.password_hash;
}
authRouter.get('/bootstrap', (req, res) => {
  if (bootstrapDisabled()) return res.status(404).render('404', {}, (err, html) => err ? res.type('text').send('Not found') : res.send(html));
  const u = Users.byEmail(ADMIN_EMAIL);
  if (!u) {
    return res.redirect('/forgot-password?error=No+admin+account+found+yet+—+restart+the+server+to+seed+it.');
  }
  if (u.password_hash) {
    return res.redirect('/forgot-password?message=The+admin+account+is+already+set+up.+Enter+your+email+below+to+reset+its+password.');
  }
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
  if (bootstrapDisabled()) return res.status(404).type('text').send('Not found');
  const u = Users.byEmail(ADMIN_EMAIL);
  if (!u) return res.redirect('/forgot-password?error=No+admin+account+found+yet+—+restart+the+server+to+seed+it.');
  if (u.password_hash) {
    return res.redirect('/forgot-password?message=The+admin+account+is+already+set+up.+Enter+your+email+below+to+reset+its+password.');
  }
  const password = String(req.body.password || '');
  const confirm  = String(req.body.confirm || '');
  const name     = String(req.body.name || '').trim();
  if (password.length < 8) return res.redirect('/bootstrap?error=Password+must+be+at+least+8+characters');
  if (password !== confirm) return res.redirect('/bootstrap?error=Passwords+do+not+match');
  const hash = await hashPassword(password);
  Users.setPassword(u.id, hash);
  if (name) {
    const db = (await import('../lib/db.js')).default;
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, u.id);
  }
  res.redirect('/login?message=Password+set.+Please+log+in.');
});

// ===== FORGOT PASSWORD =====
authRouter.get('/forgot-password', (req, res) => {
  res.render('forgot-password', {
    error: req.query.error || null,
    message: req.query.message || null,
    sent: req.query.sent === '1',
  });
});

authRouter.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.redirect('/forgot-password?error=Please+enter+your+email');

  // Never reveal whether the email exists — the response is identical either way.
  try {
    const u = Users.byEmail(email);
    if (u && u.active === 1) {
      PasswordResets.invalidateForUser(u.id); // one live link per user
      const token = newResetToken();
      const expiresAt = expiresInHours(1);
      PasswordResets.create({ user_id: u.id, token_hash: sha256(token), expires_at: expiresAt });

      const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      const resetUrl = `${base}/reset-password/${token}`;
      const result = await sendPasswordResetEmail({ to: u.email, resetUrl });
      if (result.dev) {
        // No email transport: link was printed to the console; also surface it
        // on the hab_admin dashboard so Heath can hand it to the user.
        rememberResetLink({ email: u.email, url: resetUrl, expiresAt });
      }
    }
  } catch (e) {
    console.error('[forgot-password] error (response stays generic):', e);
  }
  res.redirect('/forgot-password?sent=1');
});

// ===== RESET PASSWORD =====
function validResetRow(token) {
  if (!token || token.length > 200) return null;
  const row = PasswordResets.byTokenHash(sha256(token));
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  const u = Users.byId(row.user_id);
  if (!u || u.active !== 1) return null;
  return { row, user: u };
}

authRouter.get('/reset-password/:token', (req, res) => {
  const hit = validResetRow(req.params.token);
  if (!hit) {
    return res.redirect('/forgot-password?error=That+reset+link+is+invalid+or+has+expired.+Request+a+new+one+below.');
  }
  res.render('set-password', {
    token: req.params.token,
    email: hit.user.email,
    role: hit.user.role,
    shopName: '',
    mode: 'reset',
    error: req.query.error || null,
  });
});

authRouter.post('/reset-password/:token', async (req, res) => {
  const hit = validResetRow(req.params.token);
  if (!hit) {
    return res.redirect('/forgot-password?error=That+reset+link+is+invalid+or+has+expired.+Request+a+new+one+below.');
  }
  const password = String(req.body.password || '');
  const confirm  = String(req.body.confirm || '');
  if (password.length < 8) {
    return res.redirect(`/reset-password/${req.params.token}?error=Password+must+be+at+least+8+characters`);
  }
  if (password !== confirm) {
    return res.redirect(`/reset-password/${req.params.token}?error=Passwords+do+not+match`);
  }
  const hash = await hashPassword(password);
  Users.setPassword(hit.user.id, hash);
  PasswordResets.consume(hit.row.id);
  forgetResetLink(hit.user.email);
  res.redirect('/login?message=Password+updated.+Please+sign+in.');
});
