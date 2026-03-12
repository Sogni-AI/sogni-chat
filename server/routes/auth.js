import express from 'express';
import { SogniClient } from '@sogni-ai/sogni-client';
import { v4 as uuidv4 } from 'uuid';
import { userSessions } from '../middleware/auth.js';

const router = express.Router();

// Helper to get Sogni URLs based on environment
function getSogniUrls() {
  const env = process.env.SOGNI_ENV || 'production';

  console.log('[AUTH] Using Sogni environment:', env);

  if (env === 'staging') {
    return {
      rest: 'https://api-staging.sogni.ai',
      socket: 'wss://socket-staging.sogni.ai'
    };
  }

  // Use production by default
  return {
    rest: 'https://api.sogni.ai',
    socket: 'wss://socket.sogni.ai'
  };
}

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { username, password, remember } = req.body;

    console.log('[AUTH] Login request received', { username, hasPassword: !!password, remember });

    if (!username || !password) {
      console.log('[AUTH] Missing credentials');
      return res.status(400).json({
        error: 'Username and password are required',
        code: 400
      });
    }

    const sogniUrls = getSogniUrls();
    const appId = `sogni-chat-web-${uuidv4()}`;

    console.log(`[AUTH] Creating client for user: ${username}`, {
      appId,
      restEndpoint: sogniUrls.rest,
      socketEndpoint: sogniUrls.socket
    });

    let client;
    try {
      client = await SogniClient.createInstance({
        appId,
        network: 'fast',
        restEndpoint: sogniUrls.rest,
        socketEndpoint: sogniUrls.socket,
        testnet: process.env.SOGNI_ENV === 'staging' || process.env.SOGNI_ENV === 'local'
        // Note: removed authType: 'cookies' - not needed for server-side auth
      });
      console.log('[AUTH] Client created successfully');
    } catch (clientError) {
      console.error('[AUTH] Failed to create client:', clientError);
      throw new Error(`Failed to create Sogni client: ${clientError.message}`);
    }

    // Attempt login
    console.log('[AUTH] Attempting login...');
    try {
      await client.account.login(username, password, remember || false);
      console.log('[AUTH] Login successful');
    } catch (loginError) {
      console.error('[AUTH] Login failed:', loginError);
      console.error('[AUTH] Login error details:', {
        name: loginError?.name,
        message: loginError?.message,
        code: loginError?.code,
        payload: loginError?.payload,
        errorCode: loginError?.payload?.errorCode,
        stack: loginError?.stack
      });

      // Extract error code and message
      const errorCode = loginError?.payload?.errorCode || loginError?.code || 401;
      const errorMessage = loginError?.message || loginError?.payload?.message || 'Invalid username or password';

      return res.status(errorCode === 105 || errorCode === 128 ? 401 : 500).json({
        error: errorMessage,
        code: errorCode
      });
    }

    const account = client.account.currentAccount;

    // SDK has typo: isAuthenicated (missing 't')
    const isAuthenticated = account?.isAuthenicated || account?.isAuthenticated;

    if (!account || !isAuthenticated) {
      return res.status(401).json({
        error: 'Invalid username or password',
        code: 105
      });
    }

    // Create session
    const sessionId = uuidv4();
    userSessions.set(sessionId, {
      client,
      username: account.username,
      email: account.email,
      createdAt: Date.now()
    });

    // Set session cookie
    res.cookie('sogni-session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000 // 30 days or 1 day
    });

    res.json({
      success: true,
      user: {
        username: account.username,
        email: account.email
      }
    });

  } catch (error) {
    // This catch block should only handle unexpected errors
    // Login errors are already handled in the try block above
    console.error('[AUTH] Unexpected error:', error);
    console.error('[AUTH] Error stack:', error?.stack);
    console.error('[AUTH] Error details:', {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      payload: error?.payload
    });

    const errorCode = error?.payload?.errorCode || error?.code || 500;
    const errorMessage = error?.message || 'Login failed';

    // Ensure we always send JSON
    if (!res.headersSent) {
      res.status(errorCode === 105 || errorCode === 128 ? 401 : 500).json({
        error: errorMessage,
        code: errorCode
      });
    }
  }
});

// Check auth status
router.get('/me', async (req, res) => {
  try {
    const sessionId = req.cookies['sogni-session'];

    if (!sessionId) {
      return res.status(401).json({
        authenticated: false
      });
    }

    const session = userSessions.get(sessionId);

    if (!session) {
      return res.status(401).json({
        authenticated: false
      });
    }

    const account = session.client?.account?.currentAccount;

    // SDK has typo: isAuthenicated (missing 't')
    const isAuthenticated = account?.isAuthenicated || account?.isAuthenticated;

    if (!account || !isAuthenticated) {
      userSessions.delete(sessionId);
      return res.status(401).json({
        authenticated: false
      });
    }

    res.json({
      authenticated: true,
      user: {
        username: account.username,
        email: account.email
      }
    });

  } catch (error) {
    console.error('[AUTH] Check auth error:', error);
    res.status(500).json({
      error: 'Failed to check authentication status',
      code: 500
    });
  }
});

// Claim daily credits endpoint
router.post('/claim-daily-credits', async (req, res) => {
  try {
    const sessionId = req.cookies['sogni-session'];

    if (!sessionId) {
      return res.status(401).json({
        error: 'Not authenticated',
        code: 401
      });
    }

    const session = userSessions.get(sessionId);

    if (!session || !session.client) {
      return res.status(401).json({
        error: 'Session expired, please log in again',
        code: 401
      });
    }

    const account = session.client.account.currentAccount;

    // SDK has typo: isAuthenicated (missing 't')
    const isAuthenticated = account?.isAuthenicated || account?.isAuthenticated;

    if (!account || !isAuthenticated) {
      userSessions.delete(sessionId);
      return res.status(401).json({
        error: 'Session expired, please log in again',
        code: 401
      });
    }

    console.log('[AUTH] Claiming daily credits for user:', session.username);

    // Get the API base URL
    const sogniUrls = getSogniUrls();

    // Try to get auth token from the client
    // The SDK might store the token in various places
    let authToken = null;
    try {
      authToken = session.client.account?.client?.token ||
                  session.client.client?.token ||
                  session.client.token ||
                  account?.token ||
                  account?.data?.token;

      // Also check if there's a getToken method
      if (!authToken && typeof session.client.account?.getToken === 'function') {
        authToken = await session.client.account.getToken();
      }
      if (!authToken && typeof session.client.getToken === 'function') {
        authToken = await session.client.getToken();
      }
    } catch (e) {
      console.log('[AUTH] Could not get token from SDK:', e.message);
    }

    console.log('[AUTH] Auth token found:', !!authToken);

    // Call Sogni API to claim daily boost reward
    const claimResponse = await fetch(`${sogniUrls.rest}/v2/account/reward/claim`, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'content-type': 'application/json',
        ...(authToken ? { 'authorization': `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify({ claims: ['2'] }) // "2" is the daily boost reward ID
    });

    console.log('[AUTH] Claim response status:', claimResponse.status);

    if (!claimResponse.ok) {
      const errorData = await claimResponse.json().catch(() => ({}));
      console.error('[AUTH] Claim API error:', claimResponse.status, errorData);

      const errorMsg = errorData?.message?.toLowerCase() || '';
      if (claimResponse.status === 400 && (
        errorMsg.includes('already claimed') ||
        errorMsg.includes('already been claimed') ||
        errorMsg.includes('no rewards')
      )) {
        // Already claimed - return success anyway
        return res.json({
          success: true,
          alreadyClaimed: true,
          credits: 50,
          message: 'Daily credits already claimed'
        });
      }

      return res.status(claimResponse.status).json({
        error: errorData?.message || 'Failed to claim credits',
        code: claimResponse.status
      });
    }

    const result = await claimResponse.json();
    console.log('[AUTH] Claim result:', result);

    res.json({
      success: true,
      credits: result?.credits || result?.amount || result?.spark || 50,
      message: 'Credits claimed successfully'
    });

  } catch (error) {
    console.error('[AUTH] Claim daily credits error:', error);
    res.status(500).json({
      error: 'Failed to claim credits',
      code: 500
    });
  }
});

// Sync session - lightweight endpoint for frontend to register an authenticated user
// Called after the frontend Sogni SDK authenticates successfully
router.post('/sync-session', (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required', code: 400 });
    }

    // Check if there's already a session for this user
    const existingSessionId = req.cookies?.['sogni-session'];
    if (existingSessionId) {
      const existing = userSessions.get(existingSessionId);
      if (existing && existing.username === username) {
        return res.json({ success: true, message: 'Session already active' });
      }
      // Different user or stale session - remove old one
      userSessions.delete(existingSessionId);
    }

    const sessionId = uuidv4();
    userSessions.set(sessionId, {
      username,
      createdAt: Date.now(),
      // No full SDK client - this is a lightweight session for API access
    });

    res.cookie('sogni-session', sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    console.log(`[AUTH] Session synced for user: ${username}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[AUTH] Sync session error:', error);
    res.status(500).json({ error: 'Failed to sync session', code: 500 });
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    const sessionId = req.cookies['sogni-session'];

    if (sessionId) {
      const session = userSessions.get(sessionId);
      if (session && session.client) {
        try {
          await session.client.account.logout();
        } catch (error) {
          console.error('[AUTH] Logout error:', error);
        }
      }
      userSessions.delete(sessionId);
    }

    res.clearCookie('sogni-session');
    res.json({ success: true });

  } catch (error) {
    console.error('[AUTH] Logout error:', error);
    res.status(500).json({
      error: 'Logout failed',
      code: 500
    });
  }
});

export default router;
