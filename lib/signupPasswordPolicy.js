const WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  '1234567',
  '12345678',
  '123456789',
  'qwerty1',
  'letmein1',
  'welcome1',
  'admin123',
  'gbrides',
  'gilgit',
]);

/**
 * @param {string} password
 * @param {string} [emailLower] normalized lowercase email (local-part check)
 * @returns {string | null} error message or null if ok
 */
function validateSignupPassword(password, emailLower) {
  const pw = String(password ?? '');
  if (pw.length < 7) {
    return 'Password must be at least 7 characters';
  }
  if (pw.length > 128) {
    return 'Password is too long';
  }
  if (!/[a-zA-Z]/.test(pw)) {
    return 'Password must include at least one letter';
  }
  if (!/[0-9]/.test(pw)) {
    return 'Password must include at least one number';
  }
  if (!/[^a-zA-Z0-9]/.test(pw)) {
    return 'Password must include at least one special character (e.g. ! @ # $)';
  }
  if (/^\s/.test(pw) || /\s$/.test(pw)) {
    return 'Password cannot start or end with a space';
  }
  if (/(.)\1{5,}/.test(pw)) {
    return 'Password is too repetitive';
  }
  const lower = pw.toLowerCase();
  if (WEAK_PASSWORDS.has(lower)) {
    return 'This password is too common. Choose a stronger one';
  }
  if (emailLower && typeof emailLower === 'string' && emailLower.includes('@')) {
    const local = emailLower.split('@')[0] || '';
    if (local.length >= 3 && lower.includes(local)) {
      return 'Do not use your email address in your password';
    }
  }
  return null;
}

module.exports = { validateSignupPassword, WEAK_PASSWORDS };
