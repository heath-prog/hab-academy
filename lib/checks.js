// WP-ACADEMY-2: comprehension checks — the gate on module points.
// Questions live in content/curriculum/checks.json (answers never leave the
// server). Passing (>= passPct) unlocks the module's section points: sections
// marked complete before a pass award 0 points; the first pass retroactively
// grants points for every section already completed. Retakes are allowed and
// a pass is permanent. hab_admin is exempt from the gate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db, { Points, Progress } from './db.js';
import { POINTS } from './training.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'content', 'curriculum', 'checks.json');

let PASS_PCT = 80;
const checksByModule = new Map();
if (fs.existsSync(FILE)) {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  PASS_PCT = data.passPct || 80;
  for (const [key, val] of Object.entries(data.modules)) checksByModule.set(key, val);
  console.log(`[checks] loaded comprehension checks for ${checksByModule.size} modules (pass >= ${PASS_PCT}%)`);
} else {
  console.warn('[checks] content/curriculum/checks.json missing — module points are ungated');
}

export const Checks = {
  passPct: PASS_PCT,
  has: (moduleKey) => checksByModule.has(moduleKey),
  // Questions WITHOUT answers — safe to hand to the view.
  questionsFor: (moduleKey) => {
    const c = checksByModule.get(moduleKey);
    if (!c) return null;
    return c.questions.map((q, i) => ({ i, q: q.q, options: q.options }));
  },
  hasPassed: (userId, moduleKey) =>
    !!db.prepare('SELECT 1 FROM check_attempts WHERE user_id = ? AND module_key = ? AND passed = 1')
      .get(userId, moduleKey),
  lastAttempt: (userId, moduleKey) =>
    db.prepare('SELECT * FROM check_attempts WHERE user_id = ? AND module_key = ? ORDER BY id DESC LIMIT 1')
      .get(userId, moduleKey),
  attemptCount: (userId, moduleKey) =>
    db.prepare('SELECT COUNT(*) AS c FROM check_attempts WHERE user_id = ? AND module_key = ?')
      .get(userId, moduleKey).c,

  // Server-side grading. answers: array of option indexes (by question order).
  // Records the attempt; on a pass, retroactively grants points for sections
  // the user already completed in this module (idempotent by ledger ref).
  grade: (userId, shopId, moduleKey, answers) => {
    const c = checksByModule.get(moduleKey);
    if (!c) return null;
    const total = c.questions.length;
    let correct = 0;
    const perQuestion = c.questions.map((q, i) => {
      const given = Number.isInteger(answers[i]) ? answers[i] : -1;
      const right = given === q.answer;
      if (right) correct++;
      return { i, right };
    });
    const scorePct = Math.round((correct / total) * 100);
    const passed = scorePct >= PASS_PCT;
    db.prepare(
      `INSERT INTO check_attempts (user_id, module_key, correct, total, score_pct, passed)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, moduleKey, correct, total, scorePct, passed ? 1 : 0);
    let granted = 0;
    if (passed) granted = grantModulePoints(userId, shopId, moduleKey);
    return { correct, total, scorePct, passed, perQuestion, granted };
  },
};

// Points for every completed-but-unpaid section in the module. Idempotent:
// the ledger ref (M1:slug) is checked before each insert.
export function grantModulePoints(userId, shopId, moduleKey) {
  let granted = 0;
  for (const slug of Progress.slugsForUserModule(userId, moduleKey)) {
    const ref = `${moduleKey}:${slug}`;
    if (!Points.hasRef(userId, 'section', ref)) {
      Points.add({ userId, shopId, points: POINTS.SECTION, reason: 'section', ref });
      granted++;
    }
  }
  return granted;
}

// Does completing a section for this user/module award points right now?
export function sectionPointsUnlocked(userId, role, moduleKey) {
  if (role === 'hab_admin') return true;               // admin exempt from client gates
  if (!Checks.has(moduleKey)) return true;             // no check defined: ungated
  return Checks.hasPassed(userId, moduleKey);
}
