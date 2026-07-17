// Demo/dev seed — creates a demo shop with owner/coach/advisor logins and some
// activity so the leaderboard, team matrix and API have real data.
// SAFE TO RE-RUN. Do NOT run on production unless you want the demo users.
//
//   npm run seed:demo
//
// Logins (all password: HabDemo123!):
//   admin@demo.hab    hab_admin (no shop — sees everything)
//   owner@demo.hab    owner  @ Demo Shop
//   coach@demo.hab    coach  @ Demo Shop
//   advisor1@demo.hab advisor @ Demo Shop
//   advisor2@demo.hab advisor @ Demo Shop
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Users, Shops, Progress, Points, Mastery } from '../lib/db.js';
import db from '../lib/db.js';
import { Curriculum } from '../lib/curriculum.js';
import { POINTS } from '../lib/training.js';

const PASSWORD = 'HabDemo123!';
const hash = bcrypt.hashSync(PASSWORD, 12);

let shop = Shops.byCode('DEMOSHOP');
if (!shop) {
  const id = Shops.create({ name: 'HAB Demo Shop', code: 'DEMOSHOP' });
  shop = Shops.byId(id);
  console.log('created shop:', shop.name);
}

function ensureUser(email, role, name, shopId) {
  let u = Users.byEmail(email);
  if (!u) {
    Users.create({ email, password_hash: hash, role, shop_id: shopId, name });
    u = Users.byEmail(email);
    console.log(`created ${role}: ${email}`);
  }
  return u;
}

const admin    = ensureUser('admin@demo.hab',    'hab_admin', 'Demo HAB Admin', null);
const owner    = ensureUser('owner@demo.hab',    'owner',     'Olivia Owner',   shop.id);
const coach    = ensureUser('coach@demo.hab',    'coach',     'Casey Coach',    shop.id);
const advisor1 = ensureUser('advisor1@demo.hab', 'advisor',   'Alex Advisor',   shop.id);
const advisor2 = ensureUser('advisor2@demo.hab', 'advisor',   'Riley Rookie',   shop.id);

// Give Alex a head start: complete all of M1 + half of M2, award Advisor level.
if (Progress.totalForUser(advisor1.id) === 0 && Curriculum.loaded) {
  const m1 = Curriculum.byModuleKey('M1');
  const m2 = Curriculum.byModuleKey('M2');
  for (const s of m1.sections) {
    Progress.complete(advisor1.id, 'M1', s.slug);
    Points.add({ userId: advisor1.id, shopId: shop.id, points: POINTS.SECTION, reason: 'section', ref: `M1:${s.slug}` });
  }
  for (const s of m2.sections.slice(0, Math.ceil(m2.sections.length / 2))) {
    Progress.complete(advisor1.id, 'M2', s.slug);
    Points.add({ userId: advisor1.id, shopId: shop.id, points: POINTS.SECTION, reason: 'section', ref: `M2:${s.slug}` });
  }
  Mastery.award({ userId: advisor1.id, level: 2, awardedBy: coach.id, note: 'Passed M1 mastery check (demo seed)' });
  console.log('seeded progress for advisor1');
}

// A 3-day Take-Five streak for Alex (ending today).
{
  const ins = db.prepare('INSERT OR IGNORE INTO checkins (user_id, checkin_date, note) VALUES (?, ?, ?)');
  for (let back = 2; back >= 0; back--) {
    const d = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    if (ins.run(advisor1.id, d, 'Demo Take-Five').changes > 0) {
      Points.add({ userId: advisor1.id, shopId: shop.id, points: POINTS.CHECKIN, reason: 'checkin', ref: d });
    }
  }
}

console.log(`\nDemo ready. All demo passwords: ${PASSWORD}`);
