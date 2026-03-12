/**
 * Shared session store and auth middleware
 * Extracted from routes/auth.js so other routes can look up the current user
 */

// Store user sessions (in production, use Redis or a proper session store)
export const userSessions = new Map();

/**
 * Auth middleware - reads sogni-session cookie and attaches user info to request
 * Non-blocking: if no session found, request continues without user info
 */
export function authMiddleware(req, res, next) {
  const sessionId = req.cookies?.['sogni-session'];

  if (sessionId) {
    const session = userSessions.get(sessionId);
    if (session) {
      req.sogniUsername = session.username;
      req.sogniSession = session;
    }
  }

  next();
}

/**
 * Require auth middleware - returns 401 if not authenticated
 */
export function requireAuth(req, res, next) {
  if (!req.sogniUsername) {
    return res.status(401).json({ error: 'Authentication required', code: 401 });
  }
  next();
}
