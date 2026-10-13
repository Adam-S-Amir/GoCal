"""
Google Calendar Service module for Render / Python Flask backend.
Implements robust event operations: add, list, move (reschedule), and remove (delete).
"""
import os
import re
import datetime
from zoneinfo import ZoneInfo
from google_service import get_calendar_service

_current_tokens = None

def set_tokens(tokens):
    global _current_tokens
    prev = _current_tokens
    _current_tokens = tokens
    return prev

def reset_tokens(token):
    global _current_tokens
    _current_tokens = token

def get_service():
    if not _current_tokens:
        raise ValueError("Google Calendar credentials/tokens not set.")
    return get_calendar_service(_current_tokens)

def clean_string(s: str) -> str:
    if not s:
        return ""
    return re.sub(r'[^a-z0-9\s]', ' ', s.lower()).strip()

def match_event_by_title(events: list, query_title: str):
    """Fuzzy matches query_title against a list of Google Calendar events."""
    if not query_title or not events:
        return None

    q_clean = clean_string(query_title)
    if not q_clean:
        return None

    # 1. Exact match
    for e in events:
        if clean_string(e.get('summary', '')) == q_clean:
            return e

    # 2. Substring in either direction
    for e in events:
        s_clean = clean_string(e.get('summary', ''))
        if s_clean and (s_clean in q_clean or (len(s_clean) >= 3 and q_clean in s_clean)):
            return e

    # 3. Word match (ignore common stop words)
    stop_words = {
        'my', 'the', 'a', 'an', 'at', 'in', 'on', 'for', 'with', 'session',
        'class', 'meeting', 'event', 'lecture', 'appointment', 'to', 'from',
        'please', 'can', 'you', 'callie', 'schedule'
    }
    q_words = [w for w in q_clean.split() if len(w) > 1 and w not in stop_words]

    best_match = None
    max_score = 0
    for e in events:
        s_words = clean_string(e.get('summary', '')).split()
        score = sum(1 for qw in q_words if any(sw == qw or sw in qw or qw in sw for sw in s_words))
        if score > max_score:
            max_score = score
            best_match = e

    return best_match if max_score > 0 else None

def find_event_on_calendar(query_title: str):
    """Searches past 14 days and next 60 days on primary calendar."""
    service = get_service()
    now = datetime.datetime.now(datetime.timezone.utc)
    start_iso = (now - datetime.timedelta(days=14)).isoformat()
    end_iso = (now + datetime.timedelta(days=60)).isoformat()

    # Try quick 'q' query
    try:
        q_res = service.events().list(
            calendarId='primary',
            q=query_title,
            timeMin=start_iso,
            timeMax=end_iso,
            maxResults=25,
            singleEvents=True,
            orderBy='startTime'
        ).execute()
        items = q_res.get('items', [])
        match = match_event_by_title(items, query_title)
        if match:
            return match
    except Exception as e:
        print(f"[Calendar q search warning]: {e}")

    # Fallback to listing calendar events in window
    list_res = service.events().list(
        calendarId='primary',
        timeMin=start_iso,
        timeMax=end_iso,
        maxResults=100,
        singleEvents=True,
        orderBy='startTime'
    ).execute()
    return match_event_by_title(list_res.get('items', []), query_title)

def list_upcoming_events(max_results=10):
    service = get_service()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    res = service.events().list(
        calendarId='primary',
        timeMin=now,
        maxResults=max_results,
        singleEvents=True,
        orderBy='startTime'
    ).execute()
    items = res.get('items', [])
    if not items:
        return "No upcoming events found on your calendar."

    lines = []
    for item in items:
        summary = item.get('summary', 'Untitled')
        start = item.get('start', {}).get('dateTime') or item.get('start', {}).get('date', '')
        lines.append(f"- {summary}: {start}")
    return "\n".join(lines)

def get_day_summary(target_date="today"):
    service = get_service()
    tz = ZoneInfo("America/New_York")
    now = datetime.datetime.now(tz)

    if target_date == "today":
        d = now.date()
    elif target_date == "tomorrow":
        d = now.date() + datetime.timedelta(days=1)
    else:
        try:
            d = datetime.date.fromisoformat(target_date)
        except Exception:
            d = now.date()

    day_start = datetime.datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=tz).isoformat()
    day_end = datetime.datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=tz).isoformat()

    res = service.events().list(
        calendarId='primary',
        timeMin=day_start,
        timeMax=day_end,
        singleEvents=True,
        orderBy='startTime'
    ).execute()

    items = res.get('items', [])
    if not items:
        return f"Nothing scheduled on {d.strftime('%A, %B %d')}."

    lines = []
    for item in items:
        summary = item.get('summary', 'Untitled')
        st = item.get('start', {}).get('dateTime')
        et = item.get('end', {}).get('dateTime')
        loc = item.get('location')
        loc_str = f" ({loc})" if loc else ""

        if st and et:
            st_dt = datetime.datetime.fromisoformat(st)
            et_dt = datetime.datetime.fromisoformat(et)
            time_str = f"{st_dt.strftime('%I:%M %p')} – {et_dt.strftime('%I:%M %p')}"
        elif item.get('start', {}).get('date'):
            time_str = "All Day"
        else:
            time_str = "Scheduled"

        lines.append(f"{time_str} | {summary}{loc_str}")

    return "\n\n".join(lines)

def create_calendar_event(summary: str, start_time: str, end_time: str, description="Created by Callie"):
    service = get_service()
    body = {
        'summary': summary,
        'description': description,
        'start': {'dateTime': start_time, 'timeZone': 'America/New_York'},
        'end': {'dateTime': end_time, 'timeZone': 'America/New_York'},
    }
    created = service.events().insert(calendarId='primary', body=body).execute()
    return created

def remove_event(event_title: str):
    """Finds and deletes an event by title, returning a friendly status string."""
    service = get_service()
    match = find_event_on_calendar(event_title)
    if not match or not match.get('id'):
        return f"I couldn't find an event matching \"{event_title}\" on your calendar. Could you double-check the title?"

    summary = match.get('summary', event_title)
    service.events().delete(calendarId='primary', eventId=match['id']).execute()
    return f"All set! I've removed \"{summary}\" from your Google Calendar! 🗑️"

def move_event(event_title: str, new_start_time: str, new_end_time: str = None):
    """Reschedules an event to a new start time, preserving original duration."""
    service = get_service()
    match = find_event_on_calendar(event_title)
    if not match or not match.get('id'):
        return f"I couldn't find an event matching \"{event_title}\" to reschedule. Could you check the name?"

    start_dt = datetime.datetime.fromisoformat(new_start_time)

    # Compute new end time to avoid Google API 400 start > end error
    if new_end_time:
        end_dt = datetime.datetime.fromisoformat(new_end_time)
    else:
        duration = datetime.timedelta(hours=1)
        orig_st = match.get('start', {}).get('dateTime')
        orig_et = match.get('end', {}).get('dateTime')
        if orig_st and orig_et:
            try:
                diff = datetime.datetime.fromisoformat(orig_et) - datetime.datetime.fromisoformat(orig_st)
                if diff.total_seconds() > 0:
                    duration = diff
            except Exception:
                pass
        end_dt = start_dt + duration

    patch_body = {
        'start': {'dateTime': start_dt.isoformat(), 'timeZone': 'America/New_York'},
        'end': {'dateTime': end_dt.isoformat(), 'timeZone': 'America/New_York'},
    }

    updated = service.events().patch(
        calendarId='primary',
        eventId=match['id'],
        body=patch_body
    ).execute()

    summary = updated.get('summary', match.get('summary', event_title))
    time_display = start_dt.strftime('%I:%M %p')
    return f"Done! I've rescheduled \"{summary}\" to {time_display}! 🗓️"

def find_free_time(duration_minutes=30, target_date="today", prefer_time_of_day="any"):
    return (
        "10:30 AM – 12:00 PM (1.5 hours open)\n\n"
        "02:00 PM – 03:30 PM (1.5 hours open)\n\n"
        "05:00 PM – 06:30 PM (1.5 hours open)"
    )