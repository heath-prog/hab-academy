// Auto-seed the hab_admin account on boot so Heath can always log in.
// Idempotent:
//   - Fresh DB (zero users)            -> create admin WITH an initial password.
//   - Admin row exists, hash is NULL   -> set the initial password (legacy boot
//                                         seeded the row without one).
//   - Admin already has a password     -> do nothing.
// Demo users are NOT seeded here — that stays in `npm run seed:demo`.
import db, { Users } from './db.js';
import { hashPassword } from './auth.js';

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'heath@healthyautobusiness.com').toLowerCase();
// Emails this admin account previously used. On boot, if a user still has one of
// these and no user has ADMIN_EMAIL yet, the row is renamed in place (password,
// role, and progress are untouched).
const LEGACY_ADMIN_EMAILS = ['heath@revenuenowinc.com'];
const ADMIN_NAME = process.env.ADMIN_NAME || 'Heath Blake';
const ADMIN_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || 'HabAdmin2026!';
const usingDefault = !process.env.ADMIN_INITIAL_PASSWORD;

function banner(lines) {
  const bar = '='.repeat(68);
  console.log(`\n${bar}`);
  for (const l of lines) console.log(`  ${l}`);
  console.log(`${bar}\n`);
}

export async function ensureAdmin() {
  // Rename a legacy-email admin row to the canonical address first.
  if (!Users.byEmail(ADMIN_EMAIL)) {
    for (const legacy of LEGACY_ADMIN_EMAILS) {
      const row = Users.byEmail(legacy);
      if (row) {
        db.prepare('UPDATE users SET email = ? WHERE id = ?').run(ADMIN_EMAIL, row.id);
        banner([
          '[seed] ADMIN EMAIL UPDATED',
          `[seed] ${legacy}  ->  ${ADMIN_EMAIL}`,
          '[seed] Password unchanged. Log in with the new email.',
        ]);
        break;
      }
    }
  }

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const admin = Users.byEmail(ADMIN_EMAIL);

  if (userCount === 0) {
    const hash = await hashPassword(ADMIN_INITIAL_PASSWORD);
    Users.create({ email: ADMIN_EMAIL, password_hash: hash, role: 'hab_admin', shop_id: null, name: ADMIN_NAME });
    banner([
      '[seed] ADMIN ACCOUNT CREATED',
      `[seed] Email:    ${ADMIN_EMAIL}`,
      usingDefault
        ? '[seed] Password: HabAdmin2026!  (default — change it after first login)'
        : '[seed] Password: value of ADMIN_INITIAL_PASSWORD env var',
    ]);
    return 'created';
  }

  if (admin && !admin.password_hash) {
    const hash = await hashPassword(ADMIN_INITIAL_PASSWORD);
    Users.setPassword(admin.id, hash);
    banner([
      '[seed] ADMIN PASSWORD INITIALIZED (account existed without one)',
      `[seed] Email:    ${ADMIN_EMAIL}`,
      usingDefault
        ? '[seed] Password: HabAdmin2026!  (default — change it after first login)'
        : '[seed] Password: value of ADMIN_INITIAL_PASSWORD env var',
    ]);
    return 'password-set';
  }

  return 'noop';
}
