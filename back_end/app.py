import os
from flask import Flask, redirect, request, session, jsonify, send_from_directory
from dotenv import load_dotenv
from google_service import get_oauth_flow
from calendar_controller import list_upcoming_events
from ai_assistant import process_prompt

# Allow HTTP for local testing
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

load_dotenv()

FRONTEND_FOLDER = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'front_end', 'dist'))
app = Flask(__name__, static_folder=FRONTEND_FOLDER, static_url_path="")
app.secret_key = os.getenv("SESSION_SECRET", "dev_secret_key")


# -------------------------------------------------------------------
# AUTH & API ENDPOINTS
# -------------------------------------------------------------------
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
    return redirect('/')

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


# -------------------------------------------------------------------
# REACT CATCH-ALL ROUTE (Serves frontend for all non-API paths)
# -------------------------------------------------------------------
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")

if __name__ == '__main__':
    app.run(port=5000, debug=True)