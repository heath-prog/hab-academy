// HAB Academy — server entry.
import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import betterSqlite3 from 'better-sqlite3';
import BetterSqliteStore from 'better-sqlite3-session-store';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import './lib/db.js'; // initializes DB & schema
import { Users } from './lib/db.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { contentRouter } from './routes/content.js';
import { curriculumRouter } from './routes/curriculum.js';
import { libraryRouter } from './routes/library.js';
import { gamificationRouter } from './routes/gamification.js';
import { teamRouter } from './routes/team.js';
import { apiRouter } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Seed super_admin on boot
{
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'heath@revenuenowinc.com').toLowerCase();
  const ADMIN_NAME  = process.env.ADMIN_NAME  || 'Heath Blake';
  if (!Users.byEmail(ADMIN_EMAIL)) {
    Users.create({ email: ADMIN_EMAIL, password_hash: null, role: 'hab_admin', shop_id: null, name: ADMIN_NAME });
    console.log(`[seed] hab_admin created: ${ADMIN_EMAIL}. Visit /bootstrap to set the password.`);
  }
}

const app = express();
app.set('trust proxy', 1); // Replit sits behind an HTTPS proxy
const SqliteStore = BetterSqliteStore(session);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Open the session DB. If the existing sessions.db is unusable (e.g. a stale
// file with dead handles on a FUSE/network mount throws SQLITE_IOERR), fall
// back to a fresh file so a broken session store never blocks the whole app.
function openSessionStore() {
  const candidates = ['sessions.db', `sessions-${new Date().toISOString().slice(0, 10)}.db`];
  for (const name of candidates) {
    let db;
    try {
      db = new betterSqlite3(path.join(dataDir, name));
      // Prefer WAL; some filesystems (FUSE/network mounts) block the file
      // deletes WAL/DELETE modes need — PERSIST and MEMORY never unlink.
      for (const mode of ['WAL', 'PERSIST', 'MEMORY']) {
        try { db.pragma(`journal_mode = ${mode}`); break; } catch { /* try next */ }
      }
      const store = new SqliteStore({ client: db }); // creates the sessions table
      if (name !== candidates[0]) console.warn(`[session-db] ${candidates[0]} unusable — using ${name} instead.`);
      return store;
    } catch (e) {
      try { db?.close(); } catch { /* ignore */ }
      console.warn(`[session-db] could not use ${name}: ${e.code || e.message}`);
    }
  }
  throw new Error('Could not open any session database.');
}

app.use(session({
  store: openSessionStore(),
  secret: process.env.SESSION_SECRET || 'dev-only-please-set-SESSION_SECRET',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
  },
}));

// Make session available in views
app.use((req, res, next) => {
  res.locals.user = req.session?.userId ? {
    userId: req.session.userId,
    email: req.session.email,
    role: req.session.role,
    name: req.session.name,
    shopId: req.session.shopId,
    shopName: req.session.shopName,
  } : null;
  next();
});

// Routes
app.get('/', (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.use('/', authRouter);
app.use('/', contentRouter);
app.use('/', curriculumRouter);
app.use('/', libraryRouter);
app.use('/', gamificationRouter);
app.use('/', teamRouter);
app.use('/api', apiRouter);
app.use('/admin', adminRouter);

// 404
app.use((req, res) => res.status(404).render('404'));

// Errors
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).send(`Server error: ${err.message}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  HAB Academy listening on http://localhost:${PORT}\n`);
  if (!process.env.SMTP_USER) {
    console.log('  ⚠  SMTP not configured — invite emails will print to console only.');
  }
  console.log('  Bootstrap hab_admin password at /bootstrap (first run only).\n');
});
