/**
 * Disconnect Socket.IO connections for a user whose JWT session version is below `currentSessionVersion`.
 * Requires clients to send `token` on `authenticate` so `socket.data.sessionVersion` is set from the JWT `sv` claim.
 */
function revokeStaleUserSockets(io, userId, currentSessionVersion) {
  if (!io || userId == null) return;
  const cur = Number(currentSessionVersion);
  if (!Number.isFinite(cur) || cur < 0) return;

  const roomName = `user:${String(userId)}`;
  let room;
  try {
    room = io.sockets.adapter?.rooms?.get(roomName);
  } catch {
    return;
  }
  if (!room) return;

  for (const socketId of room) {
    let sock;
    try {
      sock = io.sockets.sockets?.get(socketId);
    } catch {
      sock = null;
    }
    if (!sock) continue;

    const raw = sock.data?.sessionVersion;
    const n = Number(raw);
    const effective = Number.isFinite(n) ? n : -1;
    if (effective < cur) {
      try {
        sock.emit('session_revoked', { reason: 'new_login', currentSessionVersion: cur });
      } catch {
        // ignore
      }
      try {
        sock.disconnect(true);
      } catch {
        // ignore
      }
    }
  }
}

module.exports = { revokeStaleUserSockets };
