# GoCal - Render Deployment & Authentication Fix Guide

## Why the app returned "invalid" after Google Sign In on Render

1. **Google Cloud Console Redirect URI Mismatch**:
   - Google strictly requires that every redirect URI requested during OAuth must match an exact entry in your Google Cloud Console's **Authorized redirect URIs**.
   - If your Render backend is hosted at `https://gocal-api.onrender.com` or custom domain `https://api.gocal.us`, that URI (`https://<your-render-url>/api/auth/callback`) MUST be added in Google Cloud Console.

2. **Reverse Proxy SSL Termination (`http` vs `https`)**:
   - Render terminates SSL at its outer load balancer and proxies traffic internally over HTTP.
   - Flask saw requests arriving as `http://.../api/auth/callback`.
   - `oauthlib` detects that `http://...` does not match the registered `https://...` redirect URI and aborts with `InsecureTransportError` or `Mismatching redirect URI`.
   - **Fix**: We added `ProxyFix` middleware from `werkzeug.middleware.proxy_fix`, which reads `X-Forwarded-Proto` and correctly restores the HTTPS scheme.

3. **Session Cookie Stripped on Cross-Site Google Redirect (`SameSite=Lax` vs `None`)**:
   - When Google redirects back from `accounts.google.com` to Render, modern browsers treat this cross-site navigation strictly.
   - Default Flask cookies without `SameSite=None` and `Secure=True` are dropped on arrival.
   - As a result, `session.get('state')` and `session.get('code_verifier')` were `None`, causing `MismatchingStateError` or invalid grant PKCE errors.
   - **Fix**: Configured `SESSION_COOKIE_SAMESITE="None"` and `SESSION_COOKIE_SECURE=True`.

4. **Frontend GIS Button Mismatch**:
   - The frontend was using Google Identity Services (`window.google.accounts.id.renderButton`), which only issues an identity ID token (without Google Calendar permissions) and simply logged to the console without contacting the backend.
   - The real OAuth flow was hardcoded to `http://localhost:5000/login`.

---

## Steps to Deploy Fixed Backend on Render

### Step 1: Update Google Cloud Console Credentials
1. Go to [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
2. Click on your OAuth 2.0 Client ID (`261130417939-bmck13fp7ncmt6f19vngk5nlltukcidg...`).
3. Under **Authorized JavaScript origins**, add:
   - `https://your-frontend.onrender.com` (or your frontend domain, e.g. `https://gocal.us`)
4. Under **Authorized redirect URIs**, add BOTH:
   - `https://your-backend.onrender.com/api/auth/callback`
   - `https://api.gocal.us/api/auth/callback` (if using custom domain)
5. Click **Save**.

### Step 2: Set Environment Variables on Render
In your Render Dashboard for the backend service:
- `PORT` = `5000` (or leave default Render port)
- `SESSION_SECRET` = `<a-long-random-string>`
- `GOOGLE_CLIENT_ID` = `261130417939-bmck13fp7ncmt6f19vngk5nlltukcidg.apps.googleusercontent.com`
- `GOOGLE_CLIENT_SECRET` = `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`
- `GOOGLE_REDIRECT_URI` = `https://<your-backend-url>.onrender.com/api/auth/callback`
- `FRONTEND_URL` = `https://<your-frontend-url>.onrender.com`
- `ALLOWED_ORIGINS` = `https://<your-frontend-url>.onrender.com,http://localhost:3000`
- `GEMINI_API_KEY` = `<your-gemini-key>`

### Step 3: Copy Fixed Files to Your GitHub Repo
Replace the following files in your GitHub repository:
- `back_end/app.py` with `render_backend_fix/app.py`
- `back_end/google_service.py` with `render_backend_fix/google_service.py`
- `back_end/requirements.txt` with `render_backend_fix/requirements.txt`
