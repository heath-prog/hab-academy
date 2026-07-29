// WP-SIGNUP: self-serve onboarding.
//   /signup                 — chooser: shop owner vs joining a team
//   /signup/owner           — owner path: account + shop + tier + term
//   /signup/agreement       — render full agreement, checkbox + typed signature
//   /join                   — team path: shop join code + account details
//   /agreement-ended        — hard-cutoff landing page for expired shops
//   /agreements/:id(/safe)  — view/print the signed snapshot (owner + hab_admin)
// Mounted BEFORE the agreement enforcement middleware so signup and agreement
// viewing stay reachable even when a shop's agreement has ended.
import express from 'express';
import {
  Users, Shops, Agreements, PendingMembers,
  assignShopToOrg, assignShopToNamedOrg, OrgUnits,
} from '../lib/db.js';
import { hashPassword, requireAuth } from '../lib/auth.js';
import { newShopCode, newJoinCode } from '../lib/tokens.js';
import {
  TIERS, TERM_OPTIONS, computeEndDate, todayISO,
  renderAgreementHtml, renderSafe,
} from '../lib/agreements.js';
import { sendWelcomeEmail } from '../lib/mailer.js';

export const signupRouter = express.Router();

const err = (path, msg) => `${path}?error=${encodeURIComponent(msg)}`;

function logInAs(req, u, cb) {
  req.session.userId   = u.id;
  req.session.email    = u.email;
  req.session.role     = u.role;
  req.session.name     = u.name;
  req.session.shopId   = u.shop_id;
  req.session.shopName = u.shop_id ? Shops.byId(u.shop_id)?.name : null;
  req.session.save(cb);
}

function baseUrl(req) {
  return (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

// ===== Chooser =====
signupRouter.get('/signup', (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  res.render('signup', { message: req.query.message || null });
});

// ===== Owner path: account + shop + tier + term =====
signupRouter.get('/signup/owner', (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  res.render('signup-owner', {
    error: req.query.error || null,
    tiers: TIERS,
    terms: TERM_OPTIONS,
    saved: req.session.pendingSignup || null,
  });
});

signupRouter.post('/signup/owner', async (req, res) => {
  const name      = String(req.body.name || '').trim();
  const email     = String(req.body.email || '').trim().toLowerCase();
  const password  = String(req.body.password || '');
  const confirm   = String(req.body.confirm || '');
  const shopName  = String(req.body.shopName || '').trim();
  const brandName = String(req.body.brandName || '').trim();
  const tier      = String(req.body.tier || '');
  const term      = parseInt(req.body.term, 10);

  const back = '/signup/owner';
  if (!name || !email || !shopName) return res.redirect(err(back, 'Name, email and shop name are required'));
  if (password.length < 8)          return res.redirect(err(back, 'Password must be at least 8 characters'));
  if (password !== confirm)         return res.redirect(err(back, 'Passwords do not match'));
  if (!TIERS[tier])                 return res.redirect(err(back, 'Pick a package'));
  if (!TERM_OPTIONS.includes(term)) return res.redirect(err(back, 'Pick an agreement term'));
  if (Users.byEmail(email))         return res.redirect(err(back, 'An account with that email already exists. Try signing in instead.'));

  // Nothing is created yet — the shop, account and agreement are all created
  // together when the agreement is signed on the next step.
  req.session.pendingSignup = {
    name, email,
    password_hash: await hashPassword(password),
    shopName, brandName, tier, term,
  };
  req.session.save(() => res.redirect('/signup/agreement'));
});

// ===== Agreement signing =====
signupRouter.get('/signup/agreement', (req, res) => {
  const p = req.session.pendingSignup;
  if (!p) return res.redirect('/signup/owner');
  const tier = TIERS[p.tier];
  const startDate = todayISO();
  const endDate = computeEndDate(startDate, p.term);
  const previewHtml = renderAgreementHtml(p.tier, {
    shopName: p.shopName,
    orgName: p.brandName || p.shopName,
    ownerName: p.name,
    ownerEmail: p.email,
    termMonths: p.term,
    startDate, endDate,
    signedName: null, // unsigned preview
  });
  const safePreviewHtml = p.tier === 'portfolio' ? renderSafe({
    shopName: p.shopName, ownerName: p.name, startDate, signedName: null,
  }) : null;
  res.render('signup-agreement', {
    pending: p, tier, startDate, endDate,
    previewHtml, safePreviewHtml,
    error: req.query.error || null,
  });
});

signupRouter.post('/signup/agreement', async (req, res) => {
  const p = req.session.pendingSignup;
  if (!p) return res.redirect('/signup/owner');
  const agreed = req.body.agree === 'on';
  const signedName = String(req.body.signedName || '').trim();
  if (!agreed)     return res.redirect(err('/signup/agreement', 'You must check the box to agree'));
  if (!signedName) return res.redirect(err('/signup/agreement', 'Type your full legal name to sign'));
  if (Users.byEmail(p.email)) return res.redirect('/login?error=An+account+with+that+email+already+exists');

  const tier = TIERS[p.tier];
  const startDate = todayISO();
  const endDate = computeEndDate(startDate, p.term);
  const signedAt = new Date().toISOString();
  const ip = req.ip || null;

  // Shop + org unit. An explicit brand name creates/reuses that org; otherwise
  // the existing assignShopToOrg name heuristics apply.
  const shopId = Shops.create({ name: p.shopName, code: newShopCode(), join_code: newJoinCode() });
  const org = p.brandName
    ? assignShopToNamedOrg(shopId, p.brandName)
    : assignShopToOrg(shopId, p.shopName);

  const userId = Users.create({
    email: p.email, password_hash: p.password_hash,
    role: 'owner', shop_id: shopId, name: p.name,
  });

  const docArgs = {
    shopName: p.shopName, orgName: org?.name || p.shopName,
    ownerName: p.name, ownerEmail: p.email,
    termMonths: p.term, startDate, endDate,
    signedName, signedAt, ip,
  };
  // Signed snapshot — recorded even if a paper agreement also exists
  // (intentional: click-wrap on record).
  const agreementHtml = renderAgreementHtml(p.tier, docArgs);
  const safeHtml = p.tier === 'portfolio' ? renderSafe(docArgs) : null;

  const agreementId = Agreements.create({
    shop_id: shopId, owner_user_id: userId,
    tier: p.tier, term_months: p.term,
    start_date: startDate, end_date: endDate,
    gp_fee_pct: tier.gp_fee_pct, mgmt_fee_pct: tier.mgmt_fee_pct, equity_pct: tier.equity_pct,
    signed_name: signedName, ip,
    agreement_html: agreementHtml,
    safe_html: safeHtml,
    safe_status: safeHtml ? 'pending_countersignature' : null,
  });

  try {
    await sendWelcomeEmail({
      to: p.email, name: p.name, shopName: p.shopName,
      roleLabel: 'shop owner', loginUrl: `${baseUrl(req)}/login`,
    });
  } catch (e) { console.error('[signup] welcome email failed:', e.message); }

  delete req.session.pendingSignup;
  const u = Users.byId(userId);
  console.log(`[signup] owner ${u.email} signed ${p.tier} agreement #${agreementId} for shop "${p.shopName}" (${p.term} months).`);
  logInAs(req, u, () => res.redirect('/dashboard'));
});

// ===== Team path: join with a shop code =====
signupRouter.get('/join', (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  res.render('join', {
    error: req.query.error || null,
    code: String(req.query.code || '').toUpperCase(),
  });
});

signupRouter.post('/join', async (req, res) => {
  const code     = String(req.body.code || '').trim().toUpperCase();
  const name     = String(req.body.name || '').trim();
  const email    = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const confirm  = String(req.body.confirm || '');
  const roleChoice = String(req.body.role || '');

  const back = `/join?code=${encodeURIComponent(code)}&`;
  const fail = (msg) => res.redirect(`${back}error=${encodeURIComponent(msg)}`);

  const shop = code ? Shops.byJoinCode(code) : null;
  if (!shop)                 return fail('That join code does not match any shop. Check with your owner.');
  if (!name || !email)       return fail('Name and email are required');
  if (password.length < 8)   return fail('Password must be at least 8 characters');
  if (password !== confirm)  return fail('Passwords do not match');
  if (!['advisor', 'technician', 'coach', 'owner'].includes(roleChoice)) return fail('Pick your role');
  if (Users.byEmail(email))  return fail('An account with that email already exists. Try signing in instead.');
  if (PendingMembers.pendingByEmail(email)) return fail('A signup with that email is already awaiting owner approval.');

  const password_hash = await hashPassword(password);

  // Advisors and technicians are self-serve. Technician is a job title on the
  // advisor access tier, not a separate role.
  if (roleChoice === 'advisor' || roleChoice === 'technician') {
    const userId = Users.create({
      email, password_hash, role: 'advisor', shop_id: shop.id, name,
      title: roleChoice === 'technician' ? 'Technician' : null,
    });
    try {
      await sendWelcomeEmail({
        to: email, name, shopName: shop.name,
        roleLabel: roleChoice === 'technician' ? 'technician' : 'service advisor',
        loginUrl: `${baseUrl(req)}/login`,
      });
    } catch (e) { console.error('[join] welcome email failed:', e.message); }
    const u = Users.byId(userId);
    return logInAs(req, u, () => res.redirect('/dashboard'));
  }

  // Coach and additional owner accounts need the owner's approval first.
  PendingMembers.create({ shop_id: shop.id, name, email, password_hash, role: roleChoice });
  console.log(`[join] ${roleChoice} signup for ${email} at "${shop.name}" is awaiting owner approval.`);
  res.render('join-pending', { shopName: shop.name, roleChoice, email });
});

// ===== Agreement-ended landing (the hard cutoff page) =====
signupRouter.get('/agreement-ended', requireAuth, (req, res) => {
  if (req.session.role === 'hab_admin') return res.redirect('/admin');
  res.render('agreement-ended', { user: req.session });
});

// ===== View/print signed snapshots (owner + hab_admin) =====
function canViewAgreement(sess, ag) {
  if (!ag) return false;
  if (sess.role === 'hab_admin') return true;
  return sess.role === 'owner' && sess.shopId === ag.shop_id;
}

signupRouter.get('/agreements/:id', requireAuth, (req, res) => {
  const ag = Agreements.byId(parseInt(req.params.id, 10));
  if (!ag) return res.status(404).render('404');
  if (!canViewAgreement(req.session, ag)) return res.status(403).render('403', { user: req.session });
  res.type('html').send(ag.agreement_html);
});

signupRouter.get('/agreements/:id/safe', requireAuth, (req, res) => {
  const ag = Agreements.byId(parseInt(req.params.id, 10));
  if (!ag || !ag.safe_html) return res.status(404).render('404');
  if (!canViewAgreement(req.session, ag)) return res.status(403).render('403', { user: req.session });
  res.type('html').send(ag.safe_html);
});
