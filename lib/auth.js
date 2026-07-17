// Auth helpers — password hashing + role checks.
import bcrypt from 'bcryptjs';

export const hashPassword  = (plain) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// Role model:
//   hab_admin — Heath. All shops, everything.
//   owner     — shop owner. Full shop visibility + user management.
//   coach     — shop coach/service manager. Full shop visibility + user management.
//   advisor   — service advisor. Own training only.
export const COACH_ROLES = ['coach', 'owner', 'hab_admin'];
export const isCoachRole = (role) => COACH_ROLES.includes(role);

export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return res.status(401).send('Not authenticated.');
  }
  next();
}

// roles: array of allowed role strings. hab_admin always allowed.
export function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.session?.role;
    if (!role) return res.redirect('/login');
    if (role === 'hab_admin' || roles.includes(role)) return next();
    return res.status(403).render('403', { user: req.session });
  };
}

// Coach-tier content (Coach's Book, posters, coach curriculum chapters).
export function canSeeCoachContent(role) {
  return isCoachRole(role);
}
