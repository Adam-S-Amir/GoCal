import os
from flask import Flask, redirect, request, session, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.middleware.proxy_fix import ProxyFix
from google_service import get_oauth_flow
from gemini_calander import chat_with_callie

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SESSION_SECRET", "super-secret-key-change-in-prod-xyz123")

# Enable ProxyFix so Werkzeug correctly reads X-Forwarded-Proto (https) from Render's reverse proxy
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# Session cookie configuration for cross-site Google OAuth redirects
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE="None",
    SESSION_COOKIE_HTTPONLY=True,
)

# Enable CORS for frontend clients
default_origins = "https://gocal.us,http://localhost:3000,http://localhost:5173"
allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", default_origins).split(",")
    if origin.strip()
]
CORS(app, supports_credentials=True, origins=allowed_origins)

def get_effective_redirect_uri():
    override = os.getenv("GOOGLE_REDIRECT_URI")
    if override:
        return override
    scheme = request.headers.get('X-Forwarded-Proto', request.scheme)
    return f"{scheme}://{request.host}/api/auth/callback"

def get_frontend_target():
    # Priority: 1) redirect_to passed during login, 2) FRONTEND_URL env var, 3) fallback to https://gocal.us
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
    is_authenticated = 'tokens' in session and session['tokens'].get('access_token') is not None
    return jsonify({
        'authenticated': bool(is_authenticated),
        'hasRefreshToken': bool(session.get('tokens', {}).get('refresh_token'))
    })

@app.route('/api/auth/logout', methods=['POST', 'GET'])
def logout():
    session.pop('tokens', None)
    session.pop('state', None)
    session.pop('code_verifier', None)
    session.pop('chat_history', None)
    return jsonify({'ok': True, 'message': 'Logged out successfully'})

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.get_json() or {}
    user_message = data.get('message', '').strip()
    user_preferences = data.get('preferences', {})

    if not user_message:
        return jsonify({'error': 'Message cannot be empty'}), 400

    tokens = session.get('tokens')
    if not tokens:
        return jsonify({
            'error': 'Unauthorized',
            'message': 'Please connect your Google Calendar first.'
        }), 401

    if 'chat_history' not in session:
        session['chat_history'] = []

    try:
        callie_response = chat_with_callie(
            user_message=user_message,
            tokens=tokens,
            chat_history=session['chat_history'],
            user_preferences=user_preferences
        )
        session.modified = True
        return jsonify({'reply': callie_response})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat/reset', methods=['POST'])
def reset_chat():
    session.pop('chat_history', None)
    return jsonify({'ok': True})

if __name__ == '__main__':
    port = int(os.getenv("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False)