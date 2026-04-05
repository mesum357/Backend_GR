const crypto = require('crypto');

/**
 * Normalize to E.164-style string with leading + (best effort for PK and international).
 */
function normalizeRiderPhone(raw) {
  let p = String(raw || '')
    .trim()
    .replace(/[\s-]/g, '');
  if (!p) return '';
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return `+${p.slice(2)}`;
  if (p.startsWith('0')) return `+92${p.slice(1)}`;
  if (/^92\d{9,10}$/.test(p)) return `+${p}`;
  if (/^3\d{9}$/.test(p)) return `+92${p}`;
  return `+${p}`;
}

const WHATSAPP_OTP_PURPOSE = {
  rider_register: 'rider_register',
  driver_register: 'driver_register',
  password_reset: 'password_reset',
};

function hashWhatsappOtp(phone, purpose, code) {
  const pepper =
    process.env.WHATSAPP_OTP_PEPPER || process.env.RIDER_OTP_PEPPER || 'gbrides-whatsapp-v1';
  return crypto.createHash('sha256').update(`${pepper}|${purpose}|${phone}|${code}`).digest('hex');
}

function verifyWhatsappOtpHash(phone, purpose, code, storedHash) {
  try {
    const a = Buffer.from(hashWhatsappOtp(phone, purpose, code), 'hex');
    const b = Buffer.from(String(storedHash), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** @deprecated use hashWhatsappOtp with WHATSAPP_OTP_PURPOSE.rider_register */
function hashRiderWhatsappOtp(phone, code) {
  return hashWhatsappOtp(phone, WHATSAPP_OTP_PURPOSE.rider_register, code);
}

function verifyRiderWhatsappOtpHash(phone, code, storedHash) {
  return verifyWhatsappOtpHash(phone, WHATSAPP_OTP_PURPOSE.rider_register, code, storedHash);
}

function isValidInternationalPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

module.exports = {
  WHATSAPP_OTP_PURPOSE,
  normalizeRiderPhone,
  hashWhatsappOtp,
  verifyWhatsappOtpHash,
  hashRiderWhatsappOtp,
  verifyRiderWhatsappOtpHash,
  isValidInternationalPhone,
};
