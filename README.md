# HAB Academy

Full name: **Healthy Auto Business Academy** (HAB = Healthy Auto Business).

Credentialed portal for the Healthy Auto Business Sales Operating System. Shops sign up, advisors get the advisor-side training materials, managers/coaches get everything plus the coaching infrastructure.

## Stack

- **Node.js 18+** with Express
- **SQLite** (`better-sqlite3`) for users/shops/invites
- **express-session** with SQLite-backed sessions
- **bcryptjs** for password hashing
- **nodemailer** with Gmail SMTP for invite emails
- **EJS** for views

## Roles

- `hab_admin` — Heath. Creates shops, invites shop owners, full visibility.
- `owner` / `coach` — Shop leadership. See all advisors' progress, award mastery levels, invite users, get coach content.
- `advisor` — Service advisor. Sees advisor content only.

## Flow

1. Heath creates a shop in `/admin/shops` and invites the owner by email.
2. Owner gets email with a tokenized link. Clicks → sets password → logs in as manager of that shop.
3. Owner goes to `/admin/users` and invites advisors/coaches at their shop by email.
4. Invitees set their password → log in → see role-appropriate dashboard.
5. Dashboard lists files. Clicking downloads/views — middleware enforces the role gate.

## Local development

```bash
npm install
cp .env.example .env
# Edit .env, set SESSION_SECRET, SMTP_USER, SMTP_PASS, ADMIN_EMAIL
npm run seed   # creates the SQLite DB and seeds Heath as hab_admin
npm start
```

Open http://localhost:3000 — log in with `ADMIN_EMAIL`. First login, Heath sets his password.

## Deploying to Replit

1. Create a new Node.js Repl.
2. Drag the project folder in.
3. In Replit Secrets, add: `SESSION_SECRET`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ADMIN_EMAIL`, `ADMIN_NAME`, `BASE_URL` (your Repl URL).
4. Run. Replit's `process.env.PORT` is honored automatically.

## Content directory

Files Live in `/content/{advisor|manager}/`. Middleware enforces:
- `/content/advisor/*` — advisor or manager
- `/content/manager/*` — manager only

To add a new file: drop it in the right folder, restart the server. The dashboard reads the directory on each request so changes show immediately.

## Backlog (v2)

- "Continue with Google" OAuth (requires Google Cloud Console redirect-URI config — easier once deployed URL is known)
- Password reset email
- User self-deactivation
- Audit log of who downloaded what
- Per-file access overrides
