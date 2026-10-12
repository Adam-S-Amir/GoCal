/**
 * Express API Router for GoCal
 * Manages Google OAuth 2.0, Calendar endpoints, and Gemini AI Chat
 */
import { Router, Request, Response } from 'express';
import * as calendarService from './calendarService.js';
import { processChat } from './geminiAssistant.js';

export const apiRouter = Router();

// In-memory session store (keyed by session cookie or bearer)
interface UserSession {
  tokens?: calendarService.UserTokens;
  user?: {
    id: string;
    email: string;
    name: string;
    picture: string;
  };
  chatHistory: Array<{ role: 'user' | 'model'; text: string }>;
  preferences: {
    bedtime: string;
    gymFrequency: string;
    gymTime: string;
    gymDuration: number;
    mealsCount: string;
    mealTime: string;
    mealDuration: number;
    snackTime: string;
    noSnack: boolean;
  };
}

const sessionStore = new Map<string, UserSession>();

function getOrCreateSession(req: Request, res: Response): { sessionId: string; session: UserSession } {
  let sessionId = req.cookies?.['gocal_session'];
  if (!sessionId || !sessionStore.has(sessionId)) {
    sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const newSession: UserSession = {
      chatHistory: [],
      preferences: {
        bedtime: '23:00',
        gymFrequency: '3-4 times a week',
        gymTime: '18:00',
        gymDuration: 60,
        mealsCount: '3 meals a day',
        mealTime: '13:00',
        mealDuration: 30,
        snackTime: '16:00',
        noSnack: false,
      },
    };
    sessionStore.set(sessionId, newSession);
    res.cookie('gocal_session', sessionId, {
      httpOnly: true,
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    return { sessionId, session: newSession };
  }
  return { sessionId, session: sessionStore.get(sessionId)! };
}

function resolveRedirectUri(req: Request): string {
  // If explicitly configured in env and valid, use it
  if (process.env.GOOGLE_REDIRECT_URI && process.env.GOOGLE_REDIRECT_URI.startsWith('http')) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  // Auto-detect based on host and protocol
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}/api/auth/callback`;
}

// 1. Get OAuth login URL
apiRouter.get('/auth/url', (req: Request, res: Response) => {
  const { session } = getOrCreateSession(req, res);
  const redirectUri = resolveRedirectUri(req);
  const state = `state_${Math.random().toString(36).substring(2, 10)}`;

  try {
    const authUrl = calendarService.generateAuthUrl(redirectUri, state);
    res.json({
      authUrl,
      redirectUri,
      clientId: process.env.GOOGLE_CLIENT_ID || '',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to generate auth URL' });
  }
});

// 2. OAuth Callback
apiRouter.get('/auth/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;
  const { session } = getOrCreateSession(req, res);

  if (error) {
    return res.redirect(`/?auth=error&message=${encodeURIComponent(String(error))}`);
  }

  if (!code || typeof code !== 'string') {
    return res.redirect('/?auth=error&message=Missing+authorization+code');
  }

  const redirectUri = resolveRedirectUri(req);

  try {
    const { tokens, user } = await calendarService.exchangeCodeForTokens(code, redirectUri);
    session.tokens = tokens;
    session.user = user;

    res.redirect('/?auth=success');
  } catch (err: any) {
    console.error('OAuth token exchange error:', err);
    res.redirect(`/?auth=error&message=${encodeURIComponent(err.message || 'Token exchange failed')}`);
  }
});

// 3. Auth Status
apiRouter.get('/auth/status', (req: Request, res: Response) => {
  const { session } = getOrCreateSession(req, res);
  const isAuthenticated = Boolean(session.tokens && (session.tokens.access_token || session.tokens.refresh_token));

  res.json({
    authenticated: isAuthenticated,
    user: session.user || (isAuthenticated ? { name: 'Google User', email: 'Connected' } : null),
    clientIdConfigured: Boolean(process.env.GOOGLE_CLIENT_ID),
    clientSecretConfigured: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    configuredRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
    detectedRedirectUri: resolveRedirectUri(req),
  });
});

// 4. Demo / Sandbox Login (for testing without Google credentials or redirect mismatch)
apiRouter.post('/auth/demo-login', (req: Request, res: Response) => {
  const { session } = getOrCreateSession(req, res);
  session.tokens = {
    access_token: 'demo_token_' + Date.now(),
    refresh_token: 'demo_refresh_token',
  };
  session.user = {
    id: 'demo_user_123',
    name: 'Alex Student',
    email: 'alex.student@university.edu',
    picture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
  };
  res.json({ ok: true, user: session.user });
});

// 5. Logout
apiRouter.post('/auth/logout', (req: Request, res: Response) => {
  const { session } = getOrCreateSession(req, res);
  session.tokens = undefined;
  session.user = undefined;
  res.json({ ok: true });
});

// 6. List Calendar Events
apiRouter.get('/events', async (req: Request, res: Response) => {
  const { session } = getOrCreateSession(req, res);
  if (!session.tokens) {
    return res.status(401).json({ error: 'Not authenticated with Google Calendar.' });
  }

  try {
    const events = await calendarService.listUpcomingEvents(session.tokens, 15);
    res.json(events);
  } catch (err: any) {
    console.error('Fetch events error:', err);
    res.status(500).json({ error: err.message || 'Failed to list events' });
  }
});

// 7. Callie AI Chat
apiRouter.post('/chat', async (req: Request, res: Response) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing "message" in request body.' });
  }

  const { session } = getOrCreateSession(req, res);

  try {
    const { reply, history } = await processChat(
      message,
      session.tokens,
      session.chatHistory,
      session.preferences
    );
    session.chatHistory = history;
    res.json({ reply });
  } catch (err: any) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message || 'Chat processing failed.' });
  }
});

// 8. Reset Chat History
apiRouter.post('/chat/reset', (req: Request, res: Response) => {
  const { session } = getOrCreateSession(req, res);
  session.chatHistory = [];
  res.json({ ok: true });
});

// 9. Save Preferences
apiRouter.post('/preferences', (req: Request, res: Response) => {
  const { session } = getOrCreateSession(req, res);
  if (req.body) {
    session.preferences = { ...session.preferences, ...req.body };
  }
  res.json({ ok: true, preferences: session.preferences });
});

// 10. Render Deployment & OAuth Diagnostics
apiRouter.get('/diagnostics', (req: Request, res: Response) => {
  const detected = resolveRedirectUri(req);
  const configured = process.env.GOOGLE_REDIRECT_URI || '';
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const hasSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET);

  res.json({
    status: 'ok',
    environment: {
      detectedRedirectUri: detected,
      configuredRedirectUri: configured,
      hasClientId: Boolean(clientId),
      clientIdMasked: clientId ? `${clientId.substring(0, 16)}...` : 'None',
      hasClientSecret: hasSecret,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    },
    renderBugAnalysis: {
      summary: 'Why Google Sign In returned "invalid" on Render and how it is fixed',
      issues: [
        {
          code: 'REDIRECT_URI_MISMATCH',
          title: 'Google Cloud Console Redirect URI Mismatch',
          description:
            'Google OAuth requires the EXACT URI requested by the backend to be listed in "Authorized redirect URIs" in Google Cloud Console. On Render, if GOOGLE_REDIRECT_URI is set to api.gocal.us before DNS is hooked up, or if your-app.onrender.com/api/auth/callback was never added to Google Cloud Console, Google immediately halts with "Error 400: redirect_uri_mismatch".',
          action: 'Add both https://<your-render-subdomain>.onrender.com/api/auth/callback and https://api.gocal.us/api/auth/callback to Google Cloud Console -> Credentials -> OAuth 2.0 Client IDs -> Authorized redirect URIs.',
        },
        {
          code: 'REVERSE_PROXY_HTTP_SCHEME',
          title: 'SSL Termination / Reverse Proxy Scheme Mismatch in Flask',
          description:
            'Render sits behind an SSL reverse proxy. Flask receives requests over HTTP internally unless ProxyFix is enabled. oauthlib sees http://... instead of https://... and fails with InsecureTransportError or invalid_grant.',
          action: 'Wrap Flask with ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1) and ensure authorization_response starts with https://.',
        },
        {
          code: 'SAMESITE_COOKIE_LOSS',
          title: 'Lost Session State on Cross-Site Google Redirect',
          description:
            'When Google redirects back to the server from accounts.google.com, default Flask cookies without SameSite=None and Secure=True are dropped by modern browsers. This causes session["state"] and session["code_verifier"] to become None, triggering "mismatching_state" or "missing code_verifier".',
          action: 'Configure app.config["SESSION_COOKIE_SAMESITE"] = "None" and app.config["SESSION_COOKIE_SECURE"] = True.',
        },
        {
          code: 'GIS_BUTTON_MISMATCH',
          title: 'Frontend Google Identity Services Button vs Calendar Scope',
          description:
            'The frontend used the Google Identity Services button (window.google.accounts.id.renderButton), which only fetches an identity ID token with callback console.log(response). It never initiated the OAuth flow for calendar access, while the real link had hardcoded localhost:5000.',
          action: 'Use the unified OAuth 2.0 flow with calendar.events and calendar scopes directly connected to the backend.',
        },
      ],
    },
  });
});
