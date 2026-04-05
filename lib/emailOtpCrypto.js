const crypto = require('crypto');

const EMAIL_OTP_PURPOSE = {
  rider_register: 'rider_register',
  driver_register: 'driver_register',
  password_reset: 'password_reset',
};

function normalizeSignupEmail(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

function hashEmailOtp(emailNorm, purpose, code) {
  const pepper =
    process.env.EMAIL_OTP_PEPPER || process.env.WHATSAPP_OTP_PEPPER || 'gbrides-email-otp-v1';
  return crypto.createHash('sha256').update(`${pepper}|${purpose}|${emailNorm}|${code}`).digest('hex');
}

function verifyEmailOtpHash(emailNorm, purpose, code, storedHash) {
  try {
    const a = Buffer.from(hashEmailOtp(emailNorm, purpose, code), 'hex');
    const b = Buffer.from(String(storedHash), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

module.exports = {
  EMAIL_OTP_PURPOSE,
  normalizeSignupEmail,
  hashEmailOtp,
  verifyEmailOtpHash,
  isValidEmail,
};
