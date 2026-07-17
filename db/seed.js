// Seed Heath as super_admin if not present. Runs on first boot automatically (and can be re-run safely).
import 'dotenv/config';
import { Users } from '../lib/db.js';

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'heath@revenuenowinc.com').toLowerCase();
const ADMIN_NAME  = process.env.ADMIN_NAME  || 'Heath Blake';

const existing = Users.byEmail(ADMIN_EMAIL);
if (existing) {
  console.log(`hab_admin already exists: ${existing.email}`);
} else {
  // Seed with no password — Heath will set it on first invite-acceptance flow,
  // OR we can give him a one-time bootstrap link printed to the console.
  const id = Users.create({
    email: ADMIN_EMAIL,
    password_hash: null,
    role: 'hab_admin',
    shop_id: null,
    name: ADMIN_NAME,
  });
  console.log(`✓ Seeded hab_admin (id=${id}, email=${ADMIN_EMAIL})`);
  console.log(`  Visit /bootstrap to set the initial password (only works while password_hash is null).`);
}
