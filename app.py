import os
from flask import Flask, redirect, request, session, jsonify
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv
from google_service import get_oauth_flow
from calendar_controller import list_upcoming_events
# Import your AI assistant function (adjust function/file name if yours is named differently)
from ai_assistant import process_prompt

load_dotenv()

IS_PRODUCTION = os.getenv("FLASK_ENV") == "production"
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

if not IS_PRODUCTION:
    # Only needed for local http:// testing. Never set this in production —
    # OAuth over plain HTTP is what it's disabling protection against.
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

app = Flask(__name__)
app.secret_key = os.getenv("SESSION_SECRET", "dev_secret_key")

# Render terminates TLS and forwards over plain HTTP internally. Without
# ProxyFix, Flask thinks every request is http:// and generates http://
# redirect/callback URLs, which Google will reject since only the https://
# callback is registered.
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# Frontend (gocal.us) and backend (api.gocal.us) are different subdomains,
# so this is a cross-origin setup. CORS with credentials + a cookie domain
# scoped to the parent domain is what lets the session cookie flow between
# them. Locally, both browser tabs are on localhost so this has no effect.
CORS(app, supports_credentials=True, origins=[FRONTEND_URL])

app.config.update(
    SESSION_COOKIE_SECURE=IS_PRODUCTION,      # cookie only sent over https in prod
    SESSION_COOKIE_SAMESITE="None" if IS_PRODUCTION else "Lax",  # "None" required for cross-subdomain
    SESSION_COOKIE_DOMAIN=os.getenv("COOKIE_DOMAIN"),  # e.g. ".gocal.us" in production, unset locally
)

@app.route('/')
def home():
    if 'tokens' in session:
        return 'Authenticated! Go to <a href="/events">/events</a> to see upcoming calendar items.'
    return 'Not logged in. Go to <a href="/login">/login</a> to authorize Google Calendar.'

@app.route('/login')
def login():
    flow = get_oauth_flow()
    auth_url, state = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        include_granted_scopes='true'
    )
    # Store state AND code_verifier in the session
    session['state'] = state
    session['code_verifier'] = flow.code_verifier
    return redirect(auth_url)

@app.route('/api/auth/callback')
def callback():
    state = session.get('state')
    
    # Pass state into the flow creation
    flow = get_oauth_flow(state=state)
    
    # Restore the code_verifier generated during /login
    flow.code_verifier = session.get('code_verifier')
    
    flow.fetch_token(authorization_response=request.url)
    creds = flow.credentials

    # Store OAuth tokens in user session
    session['tokens'] = {
        'access_token': creds.token,
        'refresh_token': creds.refresh_token,
    }
    # Send the browser back to the frontend's chat screen. Locally this is
    # Vite's dev server; in production it's the static site Render hosts at
    # gocal.us (a different subdomain from the api.gocal.us backend).
    return redirect(FRONTEND_URL)

@app.route('/events')
def get_events():
    if 'tokens' not in session:
        return jsonify({'error': 'Not authenticated. Visit /login first.'}), 401
    
    try:
        events = list_upcoming_events(session['tokens'])
        return jsonify(events)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# NEW: Gemini Chat & Action Endpoint
@app.route('/api/chat', methods=['POST'])
def chat():
    if 'tokens' not in session:
        return jsonify({'error': 'Not authenticated. Visit /login first.'}), 401

    data = request.get_json()
    if not data or 'message' not in data:
        return jsonify({'error': 'Missing "message" in request payload'}), 400

    user_message = data['message']

    try:
        # Passes prompt, active user credentials, and prior turns to the processor
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
    # Local dev only. In production this file is run via gunicorn, e.g.:
    #   gunicorn -w 2 -b 127.0.0.1:5000 app:app
    app.run(port=5000, debug=not IS_PRODUCTION)