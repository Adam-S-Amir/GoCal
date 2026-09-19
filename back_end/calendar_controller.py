import datetime
from back_end.google_service import get_calendar_service

def list_upcoming_events(tokens, max_results=5):
    """Fetches the next N upcoming events from the primary calendar."""
    service = get_calendar_service(tokens)
    now = datetime.datetime.utcnow().isoformat() + 'Z'
    
    events_result = service.events().list(
        calendarId='primary',
        timeMin=now,
        maxResults=max_results,
        singleEvents=True,
        orderBy='startTime'
    ).execute()
    
    return events_result.get('items', [])

def create_event(tokens, summary, start_time, end_time, description="Created via Gemini Assistant"):
    """Creates a new calendar event using ISO 8601 formatted datetime strings."""
    service = get_calendar_service(tokens)
    event_body = {
        'summary': summary,
        'description': description,
        'start': {'dateTime': start_time},
        'end': {'dateTime': end_time},
    }
    return service.events().insert(calendarId='primary', body=event_body).execute()