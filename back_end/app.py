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

# Fix reverse proxy headers on Render/Cloud Run for accurate HTTPS schemes
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)

# CRITICAL: SameSite=None + Secure=True allows session cookies across cross-domain redirects
app.config.update(
    SESSION_COOKIE_SAMESITE="None",
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
)

# Allow OAuth over HTTP only for local development
if os.getenv("FLASK_ENV") == "development" or os.getenv("LOCAL_DEV") == "1":
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

# Bulletproof CORS: Echoes frontend origin so cookies & headers are never rejected
@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
        response.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
    return response

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        origin = request.headers.get('Origin')
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Credentials'] = 'true'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
            response.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
        return response

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
    # Save the frontend return URL
    target = request.args.get('redirect_to') or request.referrer or os.getenv("FRONTEND_URL", "https://gocal-frontend.onrender.com")
    session['return_url'] = target

    redirect_uri = get_effective_redirect_uri()
    flow = get_oauth_flow(redirect_uri=redirect_uri)
    auth_url, state = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        include_granted_scopes='true'
    )

    # Embed code_verifier into state so mobile/Safari/iOS cookie drops NEVER lose it
    verifier = flow.code_verifier or ""
    if verifier:
        combined_state = f"{state}::{verifier}"
        auth_url = auth_url.replace(f"state={state}", f"state={combined_state}")
        session['code_verifier'] = verifier
    else:
        combined_state = state

    session['state'] = combined_state
    return redirect(auth_url)

@app.route('/api/auth/callback')
def callback():
    state_param = request.args.get('state', '')
    raw_state = state_param
    verifier = session.get('code_verifier')

    # Recover code_verifier directly from the URL if the browser dropped the cookie
    if '::' in state_param:
        raw_state, state_verifier = state_param.split('::', 1)
        verifier = state_verifier or verifier

    redirect_uri = get_effective_redirect_uri()

    auth_response_url = request.url
    if request.headers.get('X-Forwarded-Proto') == 'https' and auth_response_url.startswith('http://'):
        auth_response_url = auth_response_url.replace('http://', 'https://', 1)

    try:
        flow = get_oauth_flow(state=raw_state, redirect_uri=redirect_uri)
        if verifier:
            flow.code_verifier = verifier

        flow.fetch_token(authorization_response=auth_response_url)
        creds = flow.credentials

        existing_tokens = session.get('tokens', {})
        refresh_token = creds.refresh_token or existing_tokens.get('refresh_token')

        session['tokens'] = {
            'access_token': creds.token,
            'refresh_token': refresh_token,
        }

        # Redirect user back to Callie's chat on the frontend
        frontend_url = session.get('return_url') or os.getenv("FRONTEND_URL", "https://gocal-frontend.onrender.com")
        separator = "&" if "?" in frontend_url else "?"
        return redirect(f"{frontend_url}{separator}auth=success")
    except Exception as e:
        print(f"[OAuth Callback Error]: {e}")
        frontend_url = session.get('return_url') or os.getenv("FRONTEND_URL", "https://gocal-frontend.onrender.com")
        separator = "&" if "?" in frontend_url else "?"
        return redirect(f"{frontend_url}{separator}auth=error&error_details={str(e)}")

@app.route('/api/auth/url')
def auth_url():
    redirect_uri = get_effective_redirect_uri()
    flow = get_oauth_flow(redirect_uri=redirect_uri)
    url, state = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        include_granted_scopes='true'
    )
    
    verifier = flow.code_verifier or ""
    if verifier:
        combined_state = f"{state}::{verifier}"
        url = url.replace(f"state={state}", f"state={combined_state}")
        session['code_verifier'] = verifier
    else:
        combined_state = state

    session['state'] = combined_state
    return jsonify({
        'authUrl': url,
        'redirectUri': redirect_uri
    })

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