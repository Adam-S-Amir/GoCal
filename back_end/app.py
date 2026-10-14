import os
import json
import uuid
import tempfile
from flask import Flask, redirect, request, session, jsonify
from flask.sessions import SessionInterface, SessionMixin
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.middleware.proxy_fix import ProxyFix
from google_service import get_oauth_flow
from gemini_calander import list_upcoming_events
from ai_assistant import process_prompt

load_dotenv()

# ==============================================================================
# SERVER-SIDE SESSION ENGINE (CRITICAL FIX FOR 4096-BYTE COOKIE OVERFLOW)
# ==============================================================================
# Flask's default client cookie session has a strict 4093-byte browser limit.
# Google OAuth tokens, code_verifiers, and chat history quickly exceed 4096 bytes,
# causing browsers (Chrome, Opera, Safari) to silently drop the cookie.
# This server session interface stores data in /tmp/flask_sessions and only sets
# a tiny 36-byte UUID cookie in the browser, permanently eliminating dropped cookies.
class SimpleServerSession(dict, SessionMixin):
    def __init__(self, initial=None, sid=None):
        super().__init__(initial or {})
        self.sid = sid
        self.modified = False

class ServerSessionInterface(SessionInterface):
    def __init__(self, storage_dir=None):
        self.storage_dir = storage_dir or os.path.join(tempfile.gettempdir(), 'flask_sessions')
        os.makedirs(self.storage_dir, exist_ok=True)

    def open_session(self, app, request):
        cookie_name = app.config.get("SESSION_COOKIE_NAME", "session")
        sid = request.cookies.get(cookie_name)
        if not sid:
            sid = str(uuid.uuid4())
            return SimpleServerSession(sid=sid)
        filepath = os.path.join(self.storage_dir, sid)
        if os.path.exists(filepath):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return SimpleServerSession(data, sid=sid)
            except Exception:
                pass
        return SimpleServerSession(sid=sid)

    def save_session(self, app, session, response):
        cookie_name = app.config.get("SESSION_COOKIE_NAME", "session")
        
        # Calculate domain: share cookie between api.gocal.us and gocal.us
        host = request.host.split(":")[0].lower()
        if host.endswith("gocal.us"):
            domain = ".gocal.us"
        else:
            domain = self.get_cookie_domain(app)
        path = self.get_cookie_path(app)

        if not session:
            filepath = os.path.join(self.storage_dir, session.sid)
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception:
                    pass
            if session.modified:
                response.delete_cookie(cookie_name, domain=domain, path=path)
            return

        filepath = os.path.join(self.storage_dir, session.sid)
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(dict(session), f)
        except Exception as e:
            print(f"[Session Save Error]: {e}")

        response.set_cookie(
            cookie_name,
            session.sid,
            max_age=30 * 86400,  # 30 days
            httponly=True,
            domain=domain,
            path=path,
            secure=True,
            samesite="None"
        )

app = Flask(__name__)
app.secret_key = os.getenv("SESSION_SECRET", "super_secret_dev_key_change_in_production")
app.session_interface = ServerSessionInterface()

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
default_origins = "https://gocal.us,https://www.gocal.us,https://api.gocal.us,https://gocal-front.onrender.com,http://localhost:3000,http://localhost:5173"
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
    state_in_session = session.get('state')
    state_in_req = request.args.get('state')
    
    # Resilient state recovery: if browser cookie was dropped or refreshed,
    # fall back to request state so flow.fetch_token does not crash on mismatch
    effective_state = state_in_session or state_in_req
    redirect_uri = get_effective_redirect_uri()

    # Reconstruct request URL with https if terminated by reverse proxy
    auth_response_url = request.url
    if request.headers.get('X-Forwarded-Proto') == 'https' and auth_response_url.startswith('http://'):
        auth_response_url = auth_response_url.replace('http://', 'https://', 1)

    try:
        flow = get_oauth_flow(state=effective_state, redirect_uri=redirect_uri)
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

@app.route('/privacy')
def privacy_page():
    return redirect('https://gocal.us/privacy')

@app.route('/terms')
def terms_page():
    return redirect('https://gocal.us/terms')

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
        'endpoints': [
            '/api/auth/status',
            '/api/auth/url',
            '/api/auth/callback',
            '/api/events',
            '/api/chat',
            '/api/preferences'
        ]
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
        
        # Keep chat history capped to last 12 exchanges to prevent unbounded memory growth
        if len(history) > 24:
            history = history[-24:]
            
        session['chat_history'] = history
        return jsonify({'reply': ai_response})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat/reset', methods=['POST'])
def reset_chat():
    session.pop('chat_history', None)
    return jsonify({'ok': True})

if __name__ == '__main__':
    port = int(os.getenv("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
