// WP-IP-LOCKDOWN — server-side content protection (books, curriculum, documents).
//
// Scope: client roles only (advisor, coach, owner). hab_admin is fully exempt:
// no watermark, no print block, PDF routes stay open for fulfillment.
//
// What this layer does for client roles:
//   - Print blocking:  @media print blanks the page (public/protect.css) and
//     Ctrl/Cmd+P / beforeprint show a branded modal (public/protect.js).
//   - Copy/save deterrence: user-select disabled on reading surfaces,
//     contextmenu suppressed on content, copy events return a license notice,
//     images not draggable. Inputs/forms stay fully usable.
//   - Dynamic watermark: a fixed, repeating, semi-transparent diagonal overlay
//     carrying the licensee's name and email, rendered SERVER-SIDE into the
//     document (EJS locals or direct HTML injection) so it is part of the
//     delivered page, not something client JS adds and could simply skip.
//   - Content License notice: shown once per session on the first content view.
//
// HONEST LIMIT: no browser can prevent OS-level screenshots, screen recording,
// or a phone camera pointed at the monitor. Screenshot risk is handled by
// DETERRENCE, not prevention — every protected view is visibly watermarked
// with the licensee's identity, so any leaked capture is attributable to the
// person whose license it carries. That is the strongest protection that is
// technically available in a web app.

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export const isProtectedRole = (role) => Boolean(role) && role !== 'hab_admin';

// WP-ACADEMY-2: the copyright notice rides on every license line, which puts
// it in both the per-page license footer and the watermark overlay.
export const COPYRIGHT_LINE = '© 2026 HAB Enterprises 3 LLC. All rights reserved.';

export function licenseLine(sess) {
  const name = sess.name || sess.email;
  return `Licensed to ${name} · ${sess.email} · HAB Academy · ${COPYRIGHT_LINE}`;
}

// The diagonal repeating overlay. pointer-events:none (CSS) so the page stays
// fully usable underneath; the guard in public/protect.js re-inserts it if a
// user deletes the node, but the authoritative copy is this server render.
export function watermarkHtml(sess) {
  const line = esc(licenseLine(sess));
  const spans = Array.from({ length: 60 }, () => `<span>${line}</span>`).join('');
  return `<div class="hab-watermark" aria-hidden="true"><div class="hab-watermark-inner">${spans}</div></div>`;
}

export function licenseLineHtml(sess, style = '') {
  return `<div class="hab-license-line"${style ? ` style="${style}"` : ''}>${esc(licenseLine(sess))}</div>`;
}

// Dismissible one-per-session Content License notice.
export function noticeHtml() {
  return `<div class="hab-license-notice" id="hab-license-notice" role="dialog" aria-label="Content license">
  <h3>Content License</h3>
  <p>This material is licensed to you personally for on-screen use inside HAB Academy. It may not be reproduced, printed, downloaded, or shared with your team. Want your whole team trained on it? Team access is available through an HAB enterprise subscription.</p>
  <button type="button" class="hab-notice-btn" data-dismiss>Got it</button>
</div>`;
}

// Consume the once-per-session notice flag. Returns true exactly once per
// session for client roles, on their first protected content view.
export function takeLicenseNotice(req) {
  if (!isProtectedRole(req.session?.role)) return false;
  if (req.session.licenseNoticeShown) return false;
  req.session.licenseNoticeShown = true;
  return true;
}

// Locals for EJS content views (curriculum, library index). The header
// partial reads `protect` and emits the CSS/JS/watermark/notice.
export function protectionLocals(req, { watermark = true } = {}) {
  if (!isProtectedRole(req.session?.role)) {
    return { protect: false, protectWatermarkHtml: '', protectNoticeHtml: '', licenseLine: '' };
  }
  return {
    protect: true,
    protectWatermarkHtml: watermark ? watermarkHtml(req.session) : '',
    protectNoticeHtml: takeLicenseNotice(req) ? noticeHtml() : '',
    licenseLine: licenseLine(req.session),
  };
}

// Inject the full protection layer into a standalone HTML document (the
// /library books and /content HTML handouts, which are served as complete
// pages with their own internal CSS). Server-side injection: the watermark
// and license line ship inside the HTML response itself.
export function injectProtection(html, req) {
  const headTag = '<link rel="stylesheet" href="/protect.css">';
  const tail = [
    watermarkHtml(req.session),
    licenseLineHtml(req.session, 'margin:34px auto;max-width:900px;text-align:center;'),
    takeLicenseNotice(req) ? noticeHtml() : '',
    '<script src="/protect.js" defer></script>',
  ].filter(Boolean).join('\n');

  let out = String(html);
  out = /<\/head>/i.test(out)
    ? out.replace(/<\/head>/i, `${headTag}\n</head>`)
    : headTag + out;
  out = out.replace(/<body([^>]*)>/i, (m, attrs) => {
    if (/class\s*=\s*["']/i.test(attrs)) {
      return `<body${attrs.replace(/class\s*=\s*(["'])/i, 'class=$1hab-protected hab-nocopy ')}>`;
    }
    return `<body${attrs} class="hab-protected hab-nocopy">`;
  });
  out = /<\/body>/i.test(out)
    ? out.replace(/<\/body>/i, `\n${tail}\n</body>`)
    : out + `\n${tail}\n`;
  return out;
}
