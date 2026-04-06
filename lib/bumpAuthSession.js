const User = require('../models/User');

/**
 * Increment authSessionVersion so older JWTs become invalid. Returns updated mongoose user doc.
 */
async function bumpAuthSessionReturnUser(userId) {
  const id = userId != null ? String(userId) : '';
  if (!id) {
    throw new Error('bumpAuthSessionReturnUser: missing userId');
  }
  const u = await User.findByIdAndUpdate(
    id,
    { $inc: { authSessionVersion: 1 } },
    { new: true }
  );
  if (!u) {
    throw new Error('bumpAuthSessionReturnUser: user not found');
  }
  return u;
}

module.exports = { bumpAuthSessionReturnUser };
