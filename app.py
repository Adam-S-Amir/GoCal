import os
from flask import Flask, redirect, request, session, jsonify
from dotenv import load_dotenv
from google_service import get_oauth_flow
from calendar_controller import list_upcoming_events

# Allow HTTP for local testing
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

if __name__ == '__main__':
    app.run(port=5000, debug=True)