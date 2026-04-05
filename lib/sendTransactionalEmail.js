const nodemailer = require('nodemailer');

function createSmtpTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure =
    process.env.SMTP_SECURE === 'true' ||
    process.env.SMTP_SECURE === '1' ||
    port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: process.env.SMTP_REJECT_UNAUTHORIZED === '0' ? { rejectUnauthorized: false } : undefined,
  });
}

function getFromAddress() {
  return (
    process.env.SMTP_FROM ||
    process.env.EMAIL_FROM ||
    process.env.SMTP_USER ||
    '"GB Rides" <noreply@localhost>'
  );
}

/**
 * @param {'signup' | 'password_reset'} kind
 * @returns {Promise<{ ok: boolean, dev?: boolean, error?: unknown }>}
 */
async function sendEmailVerificationCode(toAddress, code, kind) {
  const transporter = createSmtpTransporter();
  const from = getFromAddress();
  const subject =
    kind === 'password_reset'
      ? 'GB Rides — reset your password'
      : 'GB Rides — verify your email';
  const text =
    kind === 'password_reset'
      ? `Your password reset code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`
      : `Your verification code is: ${code}\n\nIt expires in 10 minutes. Enter this code in the GB Rides app to continue sign-up.`;

  const html =
    kind === 'password_reset'
      ? `<p>Your password reset code is:</p><p style="font-size:22px;font-weight:bold;letter-spacing:4px">${code}</p><p>This code expires in 10 minutes.</p>`
      : `<p>Your email verification code is:</p><p style="font-size:22px;font-weight:bold;letter-spacing:4px">${code}</p><p>This code expires in 10 minutes.</p>`;

  if (!transporter) {
    console.log(
      `[Email OTP dev] to=${toAddress} kind=${kind} code=${code} — set SMTP_HOST, SMTP_USER, SMTP_PASS (and optional SMTP_PORT, SMTP_FROM) to send real mail`
    );
    return { ok: true, dev: true };
  }

  try {
    await transporter.sendMail({
      from,
      to: toAddress,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (e) {
    console.error('[Email] send failed:', e);
    return { ok: false, error: e };
  }
}

module.exports = { sendEmailVerificationCode, createSmtpTransporter };
