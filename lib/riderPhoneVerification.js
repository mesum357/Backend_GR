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

function hashRiderWhatsappOtp(phone, code) {
  const pepper = process.env.RIDER_OTP_PEPPER || 'gbrides-rider-whatsapp-v1';
  return crypto.createHash('sha256').update(`${pepper}|${phone}|${code}`).digest('hex');
}

function verifyRiderWhatsappOtpHash(phone, code, storedHash) {
  try {
    const a = Buffer.from(hashRiderWhatsappOtp(phone, code), 'hex');
    const b = Buffer.from(String(storedHash), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function isValidInternationalPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

module.exports = {
  normalizeRiderPhone,
  hashRiderWhatsappOtp,
  verifyRiderWhatsappOtpHash,
  isValidInternationalPhone,
};
