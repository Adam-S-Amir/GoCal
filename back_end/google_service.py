import os
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid'
]

def get_oauth_flow(state=None, redirect_uri=None):
    effective_redirect = redirect_uri or os.getenv("GOOGLE_REDIRECT_URI")
    client_config = {
        "web": {
            "client_id": os.getenv("GOOGLE_CLIENT_ID"),
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [effective_redirect]
        }
    }
    return Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=effective_redirect,
        state=state
    )

_service_cache = {}

def get_calendar_service(tokens):
    # Cache the built service client by access_token to prevent repeated discovery doc downloads
    cache_key = tokens.get('access_token') or tokens.get('refresh_token')
    if cache_key and cache_key in _service_cache:
        return _service_cache[cache_key]

    creds = Credentials(
        token=tokens.get('access_token'),
        refresh_token=tokens.get('refresh_token'),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.getenv("GOOGLE_CLIENT_ID"),
        client_secret=os.getenv("GOOGLE_CLIENT_SECRET")
    )
    try:
        service = build('calendar', 'v3', credentials=creds, static_discovery=False)
    except Exception:
        service = build('calendar', 'v3', credentials=creds)

    if cache_key:
        if len(_service_cache) > 20:
            _service_cache.clear()
        _service_cache[cache_key] = service

    return service
