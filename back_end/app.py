import os
from flask import Flask, redirect, request, session, jsonify
from dotenv import load_dotenv
from google_service import get_oauth_flow
from calendar_controller import list_upcoming_events
from ai_assistant import process_prompt

os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SESSION_SECRET", "dev_secret_key")

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
    session['state'] = state
    session['code_verifier'] = flow.code_verifier
    return redirect(auth_url)

@app.route('/api/auth/callback')
def callback():
    state = session.get('state')
    
    flow = get_oauth_flow(state=state)
    flow.code_verifier = session.get('code_verifier')
    
    flow.fetch_token(authorization_response=request.url)
    creds = flow.credentials

    existing_tokens = session.get('tokens', {})
    refresh_token = creds.refresh_token or existing_tokens.get('refresh_token')

    session['tokens'] = {
        'access_token': creds.token,
        'refresh_token': refresh_token,
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
    app.run(port=5000, debug=True)