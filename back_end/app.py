import os
from flask import Flask, redirect, request, session, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.middleware.proxy_fix import ProxyFix
from google_service import get_oauth_flow
from calendar_controller import list_upcoming_events
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
allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
    if origin.strip()
]
CORS(app, supports_credentials=True, origins=allowed_origins if allowed_origins else "*")

def get_effective_redirect_uri():
    configured = os.getenv("GOOGLE_REDIRECT_URI")
    if configured and configured.startswith("http"):
        return configured
    scheme = request.headers.get('X-Forwarded-Proto', request.scheme)
    return f"{scheme}://{request.host}/api/auth/callback"

@app.route('/')
def home():
    if 'tokens' in session:
        return 'Authenticated! Go to <a href="/events">/events</a> to see upcoming calendar items.'
    return 'Not logged in. Go to <a href="/login">/login</a> to authorize Google Calendar.'

@app.route('/login')
def login():
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

        frontend_url = os.getenv("FRONTEND_URL", "/")
        separator = "&" if "?" in frontend_url else "?"
        return redirect(f"{frontend_url}{separator}auth=success")
    except Exception as e:
        print(f"[OAuth Callback Error]: {e}")
        frontend_url = os.getenv("FRONTEND_URL", "/")
        separator = "&" if "?" in frontend_url else "?"
        return redirect(f"{frontend_url}{separator}auth=error&error_details={str(e)}")

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

@app.route('/events')
def get_events():
    if 'tokens' not in session:
        return jsonify({'error': 'Not authenticated. Visit /login first.'}), 401

    try:
        events = list_upcoming_events(session['tokens'])
        return jsonify(events)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
