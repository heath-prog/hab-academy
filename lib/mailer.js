// Nodemailer wrapper — Gmail SMTP via app password.
// In dev (no SMTP creds), it prints the email body to the console instead.
import nodemailer from 'nodemailer';

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || '"HAB Academy" <noreply@hab.local>';

let transporter = null;
if (SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

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
    console.log('  (set SMTP_USER and SMTP_PASS to enable actual sending)\n');
    return { dev: true, inviteUrl };
  }

  const info = await transporter.sendMail({ from: SMTP_FROM, to, subject, text, html });
  return { messageId: info.messageId, inviteUrl };
}
