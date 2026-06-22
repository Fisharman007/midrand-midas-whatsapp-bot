const sessions = new Map();

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { state: 'IDLE', data: {}, lastActivity: Date.now() });
  }
  const session = sessions.get(userId);
  session.lastActivity = Date.now();
  return session;
}

function updateSession(userId, updates) {
  const session = getSession(userId);
  const merged = { ...session, ...updates, lastActivity: Date.now() };
  sessions.set(userId, merged);
}

function clearSession(userId) {
  sessions.set(userId, { state: 'IDLE', data: {}, lastActivity: Date.now() });
}

// Purge sessions idle for more than 30 minutes
setInterval(() => {
  const cutoff = Date.now() - SESSION_TIMEOUT_MS;
  for (const [userId, session] of sessions.entries()) {
    if (session.lastActivity < cutoff) {
      sessions.delete(userId);
    }
  }
}, 10 * 60 * 1000);

module.exports = { getSession, updateSession, clearSession };
