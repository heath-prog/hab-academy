// When no email transport is configured, password-reset links are logged to
// the console AND kept here (in memory) so the hab_admin dashboard can show
// them for copy/paste. Tokens themselves are stored hashed in SQLite; this
// list only lives for the process lifetime and only ever holds unexpired,
// unused links.
const links = [];

export function rememberResetLink({ email, url, expiresAt }) {
  forgetResetLink(email); // one live link per email
  links.push({ email, url, expiresAt, createdAt: new Date().toISOString() });
}

export function forgetResetLink(email) {
  const i = links.findIndex((l) => l.email === email);
  if (i !== -1) links.splice(i, 1);
}

export function pendingResetLinks() {
  const now = Date.now();
  for (let i = links.length - 1; i >= 0; i--) {
    if (new Date(links[i].expiresAt).getTime() < now) links.splice(i, 1);
  }
  return [...links].reverse(); // newest first
}
