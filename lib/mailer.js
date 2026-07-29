// Nodemailer wrapper — Gmail SMTP via app password.
// In dev (no SMTP creds), it prints the email body to the console instead.
import nodemailer from 'nodemailer';

// Accept either GMAIL_USER/GMAIL_APP_PASSWORD or the older SMTP_USER/SMTP_PASS.
const MAIL_USER = process.env.GMAIL_USER || process.env.SMTP_USER;
const MAIL_PASS = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || (MAIL_USER ? `"HAB Academy" <${MAIL_USER}>` : '"HAB Academy" <noreply@hab.local>');

let transporter = null;
if (MAIL_USER && MAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: MAIL_USER, pass: MAIL_PASS },
  });
}

export const mailerConfigured = () => transporter !== null;

export async function sendInviteEmail({ to, shopName, roleLabel, inviteUrl, inviterName }) {
  const subject = `You're invited to HAB Academy — ${shopName}`;
  const html = `
<!DOCTYPE html>
<html><body style="font-family:Helvetica,Arial,sans-serif;color:#1A1A1A;line-height:1.5;max-width:560px;margin:24px auto;">
  <div style="background:#1B3358;color:#fff;padding:18px 24px;border-bottom:4px solid #C8A75C;">
    <div style="font-size:11px;letter-spacing:4px;color:#C8A75C;font-weight:700;">THE HAB ACADEMY</div>
    <div style="font-size:22px;font-family:Georgia,serif;font-weight:700;margin-top:4px;">You're invited.</div>
  </div>
  <div style="padding:22px 24px;background:#fff;border:1px solid #F0E2BE;border-top:none;">
    <p>${inviterName ? `${inviterName} from ` : ''}<strong>${shopName}</strong> invited you to HAB Academy as a <strong>${roleLabel}</strong>.</p>
    <p>Click the button below to set your password and log in. This link expires in 7 days.</p>
    <p style="margin:24px 0;">
      <a href="${inviteUrl}" style="background:#1B3358;color:#C8A75C;text-decoration:none;padding:12px 22px;display:inline-block;border-radius:4px;font-weight:700;letter-spacing:1px;">
        ACCEPT INVITE
      </a>
    </p>
    <p style="font-size:12px;color:#555;">If the button doesn't work, paste this into your browser:<br>
      <a href="${inviteUrl}" style="color:#1B3358;">${inviteUrl}</a>
    </p>
  </div>
  <div style="padding:14px 24px;background:#1B3358;color:#FAF4E4;font-size:11px;font-style:italic;text-align:center;border-top:4px solid #C8A75C;">
    Do what's Right · Do what's Fair · Do Your Best.
  </div>
</body></html>`;

  const text =
`You're invited to HAB Academy — ${shopName}

${inviterName ? `${inviterName} from ` : ''}${shopName} invited you to HAB Academy as a ${roleLabel}.

Click the link below to set your password and log in (expires in 7 days):

${inviteUrl}

— HAB Academy
Do what's Right · Do what's Fair · Do Your Best.`;

  if (!transporter) {
    console.log('\n[mailer] SMTP not configured — printing invite email instead:');
    console.log(`  TO:      ${to}`);
    console.log(`  SUBJECT: ${subject}`);
    console.log(`  URL:     ${inviteUrl}`);
    console.log('  (set GMAIL_USER and GMAIL_APP_PASSWORD to enable actual sending)\n');
    return { dev: true, inviteUrl };
  }

  const info = await transporter.sendMail({ from: SMTP_FROM, to, subject, text, html });
  return { messageId: info.messageId, inviteUrl };
}

export async function sendPasswordResetEmail({ to, resetUrl }) {
  const subject = 'Reset your HAB Academy password';
  const html = `
<!DOCTYPE html>
<html><body style="font-family:Helvetica,Arial,sans-serif;color:#1A1A1A;line-height:1.5;max-width:560px;margin:24px auto;">
  <div style="background:#1B3358;color:#fff;padding:18px 24px;border-bottom:4px solid #C8A75C;">
    <div style="font-size:11px;letter-spacing:4px;color:#C8A75C;font-weight:700;">THE HAB ACADEMY</div>
    <div style="font-size:22px;font-family:Georgia,serif;font-weight:700;margin-top:4px;">Password reset</div>
  </div>
  <div style="padding:22px 24px;background:#fff;border:1px solid #F0E2BE;border-top:none;">
    <p>Someone (hopefully you) asked to reset the HAB Academy password for <strong>${to}</strong>.</p>
    <p>Click the button below to choose a new password. This link works once and expires in 1 hour.</p>
    <p style="margin:24px 0;">
      <a href="${resetUrl}" style="background:#1B3358;color:#C8A75C;text-decoration:none;padding:12px 22px;display:inline-block;border-radius:4px;font-weight:700;letter-spacing:1px;">
        RESET PASSWORD
      </a>
    </p>
    <p style="font-size:12px;color:#555;">If the button doesn't work, paste this into your browser:<br>
      <a href="${resetUrl}" style="color:#1B3358;">${resetUrl}</a>
    </p>
    <p style="font-size:12px;color:#555;">Didn't request this? You can safely ignore this email — your password is unchanged.</p>
  </div>
  <div style="padding:14px 24px;background:#1B3358;color:#FAF4E4;font-size:11px;font-style:italic;text-align:center;border-top:4px solid #C8A75C;">
    Do what's Right · Do what's Fair · Do Your Best.
  </div>
</body></html>`;

  const text =
`Reset your HAB Academy password

Someone (hopefully you) asked to reset the HAB Academy password for ${to}.

Use the link below to choose a new password (works once, expires in 1 hour):

${resetUrl}

Didn't request this? Ignore this email — your password is unchanged.

— HAB Academy`;

  if (!transporter) {
    console.log('\n[mailer] Email not configured — password reset link (copy/paste to the user):');
    console.log(`  USER: ${to}`);
    console.log(`  LINK: ${resetUrl}`);
    console.log('  (expires in 1 hour; also shown on the hab_admin Shops dashboard)\n');
    return { dev: true, resetUrl };
  }

  const info = await transporter.sendMail({ from: SMTP_FROM, to, subject, text, html });
  return { messageId: info.messageId, resetUrl };
}
