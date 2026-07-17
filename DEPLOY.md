# Deploying HAB Academy to Replit

The whole project is in `hab-academy/`. There's also a `hab-academy.zip` in your Healthy AI Business folder (2.4 MB) with the same contents excluding `node_modules` and `data`.

## Fastest path — 5 minutes

1. Open https://replit.com (sign in if needed).
2. Click **Create Repl** → **Node.js** (blank). Name it `hab-academy` (or whatever).
3. Replit gives you a blank Repl with an `index.js`. Delete that file.
4. Drag `hab-academy.zip` into the Replit file tree.
5. Open the **Shell** tab at the bottom and run:
   ```
   unzip hab-academy.zip && mv hab-academy-deploy/* hab-academy-deploy/.* . 2>/dev/null; rm -rf hab-academy-deploy hab-academy.zip
   ```
6. Click **Secrets** (lock icon, left sidebar) and add:
   - `SESSION_SECRET` — any long random string (e.g. 40+ chars of mixed case + digits)
   - `SMTP_USER` — `heath.blake3@gmail.com`
   - `SMTP_PASS` — your Gmail App Password (myaccount.google.com → Security → 2-Step Verification → App passwords)
   - `SMTP_FROM` — `HAB Academy <heath.blake3@gmail.com>`
   - `ADMIN_EMAIL` — `heath@revenuenowinc.com`
   - `ADMIN_NAME` — `Heath Blake`
   - `BASE_URL` — your Repl's URL (e.g. `https://hab-academy.YOURUSERNAME.repl.co`) — you'll fill this in after you Run once.
7. Click **Run**. Replit installs deps and starts the server.
8. Click the Webview tab → navigate to `/bootstrap` to set your super-admin password.
9. After the first run, copy the live URL from the Webview and update `BASE_URL` in Secrets so invite emails point at the right place. Click **Stop**, then **Run** again.

## What you can do once it's live

- Sign in as `heath@revenuenowinc.com`.
- Visit **/admin/shops** → create a shop, enter the owner's email. They get an invite.
- Or jump to **/admin/users?shopId=X** to invite advisors/coaches directly.
- Visit **/dashboard** to see what each role sees (super-admin sees all).

## If invite emails don't arrive

Check Replit console output. If SMTP isn't configured, the invite URL prints to the console instead — copy-paste it manually until SMTP is set.

## Adding content later

Drop files into:
- `content/advisor/` — visible to advisors and managers
- `content/manager/` — visible to managers only

No code change needed; the dashboard reads the folder on each request.

## v2 backlog

- **Continue with Google OAuth** — needs the deployed URL set as a redirect URI in Google Cloud Console. Easy to add once we have the URL.
- **Password reset emails** — straightforward, uses the same SMTP transport.
- **Audit log** — who downloaded what, when.
