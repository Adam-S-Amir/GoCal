import os
from flask import Flask, redirect, request, session, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.middleware.proxy_fix import ProxyFix
from google_service import get_oauth_flow
from gemini_calander import list_upcoming_events
from ai_assistant import process_prompt

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SESSION_SECRET", "super_secret_dev_key_change_in_production")

# Fix reverse proxy headers (CRITICAL on Render, Cloud Run, Heroku)
# This ensures request.scheme and request.url accurately reflect https://
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)

# CRITICAL FOR CLOUD / RENDER AUTH:
# When Google redirects back cross-site from accounts.google.com,
# SameSite must be 'None' and Secure must be True so cookies are NOT dropped.
app.config.update(
    SESSION_COOKIE_SAMESITE="None",
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
)

# Allow OAuth over HTTP only for local development
if os.getenv("FLASK_ENV") == "development" or os.getenv("LOCAL_DEV") == "1":
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

# Enable CORS for frontend clients
default_origins = "https://gocal.us,http://localhost:3000,http://localhost:5173"
allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", default_origins).split(",")
    if origin.strip()
]
CORS(app, supports_credentials=True, origins=allowed_origins if allowed_origins else "*")

def get_effective_redirect_uri():
    configured = os.getenv("GOOGLE_REDIRECT_URI")
    if configured and configured.startswith("http"):
        return configured
    scheme = request.headers.get('X-Forwarded-Proto', request.scheme)
    return f"{scheme}://{request.host}/api/auth/callback"

def get_frontend_target():
    target = session.pop('redirect_to', None) or os.getenv("FRONTEND_URL", "https://gocal.us")
    if target and not (target.startswith("http://") or target.startswith("https://") or target.startswith("/")):
        target = f"https://{target}"
    return target

@app.route('/')
def home():
    if 'tokens' in session:
        return redirect(f"{get_frontend_target()}?auth=success")
    return redirect(get_frontend_target())

@app.route('/login')
def login():
    # Save the return destination passed by frontend (e.g. /login?redirect_to=https://gocal.us)
    redirect_to = request.args.get('redirect_to')
    if redirect_to:
        session['redirect_to'] = redirect_to
    elif request.referrer and 'google.com' not in request.referrer:
        session['redirect_to'] = request.referrer

    redirect_uri = get_effective_redirect_uri()
    flow = get_oauth_flow(redirect_uri=redirect_uri)
    auth_url, state = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        include_granted_scopes='true'
    )
    session['state'] = state
    if flow.code_verifier:
        session['code_verifier'] = flow.code_verifier
    return redirect(auth_url)

@app.route('/api/auth/url')
def auth_url():
    redirect_uri = get_effective_redirect_uri()
    flow = get_oauth_flow(redirect_uri=redirect_uri)
    url, state = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        include_granted_scopes='true'
    )
    session['state'] = state
    if flow.code_verifier:
        session['code_verifier'] = flow.code_verifier
    return jsonify({
        'authUrl': url,
        'redirectUri': redirect_uri
    })

@app.route('/api/auth/callback')
def callback():
    state = session.get('state')
    redirect_uri = get_effective_redirect_uri()

    # Reconstruct request URL with https if terminated by reverse proxy
    auth_response_url = request.url
    if request.headers.get('X-Forwarded-Proto') == 'https' and auth_response_url.startswith('http://'):
        auth_response_url = auth_response_url.replace('http://', 'https://', 1)

    try:
        flow = get_oauth_flow(state=state, redirect_uri=redirect_uri)
        if session.get('code_verifier'):
            flow.code_verifier = session.get('code_verifier')

        flow.fetch_token(authorization_response=auth_response_url)
        creds = flow.credentials

        existing_tokens = session.get('tokens', {})
        refresh_token = creds.refresh_token or existing_tokens.get('refresh_token')

        session['tokens'] = {
            'access_token': creds.token,
            'refresh_token': refresh_token,
        }

        target_url = get_frontend_target()
        separator = "&" if "?" in target_url else "?"
        return redirect(f"{target_url}{separator}auth=success")
    except Exception as e:
        print(f"[OAuth Callback Error]: {e}")
        target_url = get_frontend_target()
        separator = "&" if "?" in target_url else "?"
        return redirect(f"{target_url}{separator}auth=error&error_details={str(e)}")

@app.errorhandler(404)
def handle_404(e):
    if 'gocal.us' in request.path:
        return redirect('https://gocal.us?auth=success')
    return jsonify({'error': 'Not found', 'path': request.path}), 404

@app.route('/api/auth/status')
def auth_status():
    has_tokens = 'tokens' in session
    return jsonify({
        'authenticated': has_tokens,
        'effective_redirect_uri': get_effective_redirect_uri(),
        'has_refresh_token': bool(session.get('tokens', {}).get('refresh_token')) if has_tokens else False
    })

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.pop('tokens', None)
    session.pop('chat_history', None)
    return jsonify({'ok': True})

@app.route('/healthz')
@app.route('/api/health')
def healthz():
    return jsonify({'status': 'ok', 'service': 'gocal-backend'})

@app.route('/api')
def api_index():
    return jsonify({
        'message': 'GoCal Backend API is running',
        'endpoints': ['/api/auth/status', '/api/auth/url', '/api/auth/callback', '/api/events', '/api/chat', '/api/preferences']
    })

@app.route('/events')
@app.route('/api/events')
def get_events():
    if 'tokens' not in session:
        return jsonify({'error': 'Not authenticated. Visit /login first.'}), 401

    try:
        events = list_upcoming_events(session['tokens'])
        return jsonify(events)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/preferences', methods=['GET', 'POST'])
def preferences():
    if request.method == 'POST':
        data = request.get_json() or {}
        session['preferences'] = data
        return jsonify({'ok': True, 'preferences': data})
    return jsonify(session.get('preferences', {}))

@app.route('/api/chat', methods=['POST'])
def chat():
    if 'tokens' not in session:
        return jsonify({'error': 'Not authenticated. Visit /login first.'}), 401

    data = request.get_json()
    if not data or 'message' not in data:
        return jsonify({'error': 'Missing "message" in request payload'}), 400

    user_message = data['message']

    try:
        history = session.get('chat_history', [])
        ai_response, history = process_prompt(user_message, session['tokens'], history)
        session['chat_history'] = history
        return jsonify({'reply': ai_response})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat/reset', methods=['POST'])
def reset_chat():
    session.pop('chat_history', None)
    return jsonify({'ok': True})

@app.route('/privacy')
def privacy_policy():
    return """<!DOCTYPE html>
<html>
<head><title>Privacy Policy - Callie Calendar Assistant</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222}h1,h2{color:#111}</style></head>
<body>
<h1>Privacy Policy</h1>
<p>Last updated: October 2026</p>
<h2>1. Overview</h2>
<p>Callie ("we", "our", or "the application") is an AI calendar assistant designed to help college students and busy individuals manage their daily schedules.</p>
<h2>2. Google User Data</h2>
<p>Callie requests access to Google Calendar API data (events and calendar read/write) solely to:</p>
<ul>
<li>Display your upcoming events when you ask for your schedule.</li>
<li>Add, move, reschedule, or remove events based on your direct conversational requests.</li>
<li>Analyze open time windows to suggest downtime and study sessions.</li>
</ul>
<h2>3. Data Protection and Sharing</h2>
<p>We do not sell, rent, or trade your Google Calendar data to any third parties. Your calendar tokens and data are used strictly to fulfill your direct assistant commands.</p>
<h2>4. Revoking Access</h2>
<p>You can revoke Callie's access to your Google Account at any time in your <a href="https://myaccount.google.com/permissions" target="_blank">Google Account Permissions</a>.</p>
<h2>5. Contact</h2>
<p>For questions or privacy inquiries, contact the developer via GitHub or email.</p>
</body>
</html>"""

@app.route('/terms')
def terms_of_service():
    return """<!DOCTYPE html>
<html>
<head><title>Terms of Service - Callie Calendar Assistant</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222}h1,h2{color:#111}</style></head>
<body>
<h1>Terms of Service</h1>
<p>Last updated: October 2026</p>
<h2>1. Acceptance of Terms</h2>
<p>By signing in and using Callie Calendar Assistant, you agree to these Terms of Service.</p>
<h2>2. Use of Service</h2>
<p>Callie is provided to help you organize personal calendar events. You are responsible for ensuring the accuracy of your scheduled appointments and meetings.</p>
<h2>3. Disclaimer</h2>
<p>The application is provided "as is" without warranty of any kind. We are not liable for missed meetings, scheduling conflicts, or external calendar service disruptions.</p>
</body>
</html>"""

if __name__ == '__main__':
    port = int(os.getenv("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False)

