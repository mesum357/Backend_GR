/**
 * Central secret resolution — refuse weak defaults in production-like environments.
 */

const WEAK_JWT = new Set(['', 'your-jwt-secret', 'secret', 'jwt-secret', 'changeme']);
const WEAK_SESSION = new Set(['', 'your-secret-key', 'secret', 'changeme']);
const WEAK_ADMIN_PASS = new Set(['', 'admin12345', 'admin', 'password', '123456']);

function isProductionLike() {
  const env = String(process.env.NODE_ENV || '').toLowerCase();
  return env === 'production' || process.env.FORCE_SECURE_SECRETS === '1';
}

function getJwtSecret() {
  const s = process.env.JWT_SECRET != null ? String(process.env.JWT_SECRET).trim() : '';
  if (s && !WEAK_JWT.has(s)) return s;
  if (isProductionLike()) {
    throw new Error(
      'JWT_SECRET must be set to a strong unique value (NODE_ENV=production or FORCE_SECURE_SECRETS=1).'
    );
  }
  return s || 'your-jwt-secret';
}

function getSessionSecret() {
  const s = process.env.SESSION_SECRET != null ? String(process.env.SESSION_SECRET).trim() : '';
  if (s && !WEAK_SESSION.has(s)) return s;
  if (isProductionLike()) {
    throw new Error(
      'SESSION_SECRET must be set to a strong unique value (NODE_ENV=production or FORCE_SECURE_SECRETS=1).'
    );
  }
  return s || 'your-secret-key';
}

/** Throws in production if admin login still uses known default password. */
function assertAdminSecretsConfigured() {
  if (!isProductionLike()) return;
  const pass = process.env.ADMIN_PASSWORD != null ? String(process.env.ADMIN_PASSWORD) : '';
  if (!pass || WEAK_ADMIN_PASS.has(pass)) {
    throw new Error(
      'ADMIN_PASSWORD must be set to a strong non-default value in production.'
    );
  }
  const email = process.env.ADMIN_EMAIL != null ? String(process.env.ADMIN_EMAIL).trim() : '';
  if (!email) {
    throw new Error('ADMIN_EMAIL must be set in production.');
  }
}

function assertRuntimeSecretsOrExit() {
  try {
    getJwtSecret();
    getSessionSecret();
    assertAdminSecretsConfigured();
  } catch (err) {
    console.error('❌ Secure secrets check failed:', err.message || err);
    process.exit(1);
  }
}

/** Authenticated socket user id, or null. */
function socketUserId(socket) {
  const id = socket?.data?.userId;
  return id != null && String(id).trim() ? String(id) : null;
}

module.exports = {
  isProductionLike,
  getJwtSecret,
  getSessionSecret,
  assertAdminSecretsConfigured,
  assertRuntimeSecretsOrExit,
  socketUserId,
};
