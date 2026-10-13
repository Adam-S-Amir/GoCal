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

# Fix reverse proxy headers (CRITICAL on Render)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)

# Ensure cookies are preserved cross-site when Google redirects
app.config.update(
    SESSION_COOKIE_SAMESITE="None",
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
)

if os.getenv("FLASK_ENV") == "development" or os.getenv("LOCAL_DEV") == "1":
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

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

    try:
        flow = get_oauth_flow(state=state, redirect_uri=redirect_uri)
        code_verifier = session.get('code_verifier')
        if code_verifier:
            flow.code_verifier = code_verifier

        flow.fetch_token(authorization_response=request.url)
        creds = flow.credentials

        refresh_token = creds.refresh_token
        if not refresh_token and 'tokens' in session:
            refresh_token = session['tokens'].get('refresh_token')

        session['tokens'] = {
            'token': creds.token,
            'refresh_token': refresh_token,
            'token_uri': creds.token_uri,
            'client_id': creds.client_id,
            'client_secret': creds.client_secret,
            'scopes': creds.scopes,
            'access_token': creds.token,
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

if __name__ == '__main__':
    port = int(os.getenv("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False)