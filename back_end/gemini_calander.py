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

def extract_hour_minute_hint(time_hint: str):
    """Tries to extract (hour_24, minute) from hints like '2pm', '2:30pm', '14:00', '10am', '6:00 PM'."""
    if not time_hint:
        return None
    th = str(time_hint).lower().strip()
    m = re.search(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)?', th)
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2)) if m.group(2) else 0
    ampm = m.group(3)
    if ampm == 'pm' and hour < 12:
        hour += 12
    elif ampm == 'am' and hour == 12:
        hour = 0
    return (hour, minute)

def match_event_by_title(events: list, query_title: str, time_hint: str = None):
    """
    Fuzzy matches query_title and optional time_hint against a list of Google Calendar events.
    Prioritizes events matching time_hint or closest summary.
    """
    if not events:
        return None

    time_target = extract_hour_minute_hint(time_hint)

    def matches_time(e):
        if not time_target:
            return False
        st_raw = e.get('start', {}).get('dateTime')
        if not st_raw:
            return False
        try:
            dt = datetime.datetime.fromisoformat(st_raw)
            return dt.hour == time_target[0] and (time_target[1] == 0 or abs(dt.minute - time_target[1]) <= 15)
        except Exception:
            return False

    q_clean = clean_string(query_title) if query_title else ""

    # If title is empty or generic time phrase (e.g. "2pm", "meeting"), match by time directly
    generic_words = {'2pm', '3pm', '4pm', '10am', '11am', '12pm', '1pm', 'event', 'meeting', 'appointment'}
    if (not q_clean or q_clean in generic_words) and time_target:
        for e in events:
            if matches_time(e):
                return e

    if not q_clean and not time_target:
        return None

    # Step 1: Exact summary match + time match
    if q_clean and time_target:
        for e in events:
            if clean_string(e.get('summary', '')) == q_clean and matches_time(e):
                return e

    # Step 2: Substring match + time match (e.g. user says 'spanish' + 6pm, event is 'Study Spanish' at 6pm)
    if q_clean and time_target:
        for e in events:
            s_clean = clean_string(e.get('summary', ''))
            if len(s_clean) >= 3 and len(q_clean) >= 3:
                if (s_clean in q_clean or q_clean in s_clean) and matches_time(e):
                    return e

    # Step 3: Exact summary match
    if q_clean:
        for e in events:
            if clean_string(e.get('summary', '')) == q_clean:
                return e

        # Step 4: Substring match (minimum 3 chars to avoid false positives)
        for e in events:
            s_clean = clean_string(e.get('summary', ''))
            if len(s_clean) >= 3 and len(q_clean) >= 3:
                if s_clean in q_clean or q_clean in s_clean:
                    return e

    # Step 5: Token / Word Containment Match
    # If the user says "spanish", and an event is "Study Spanish", "Spanish Class", etc.
    stop_words = {
        'my', 'the', 'a', 'an', 'at', 'in', 'on', 'for', 'with', 'session',
        'class', 'meeting', 'event', 'lecture', 'appointment', 'to', 'from',
        'please', 'can', 'you', 'callie', 'schedule', 'move', 'reschedule',
        'it', 'that', 'this'
    }
    q_words = [w for w in q_clean.split() if len(w) > 1 and w not in stop_words] if q_clean else []

    # Check for direct word containment with time match
    if q_words and time_target:
        for e in events:
            s_words = [w for w in clean_string(e.get('summary', '')).split() if w not in stop_words]
            if any(qw in s_words for qw in q_words) and matches_time(e):
                return e

    # Check for direct word containment without time match
    if q_words:
        for e in events:
            s_words = [w for w in clean_string(e.get('summary', '')).split() if w not in stop_words]
            if any(qw in s_words for qw in q_words):
                return e

    # Step 6: Word scoring match with partial stems
    best_match = None
    max_score = 0
    for e in events:
        s_clean = clean_string(e.get('summary', ''))
        s_words = s_clean.split()
        score = 0
        for qw in q_words:
            if qw in s_words:
                score += 4
            elif qw in s_clean:
                score += 3
            elif any(qw in sw or sw in qw for sw in s_words if len(sw) >= 3 and len(qw) >= 3):
                score += 2

        if matches_time(e):
            score += 5

        if score > max_score:
            max_score = score
            best_match = e

    return best_match if max_score > 0 else None

def find_event_on_calendar(query_title: str, time_hint: str = None, date_hint: str = None):
    """
    Searches for an event on primary calendar.
    - If date_hint is specified (e.g. 'yesterday', 'tomorrow', '2026-10-12'), searches that specific day window first.
    - Otherwise, prioritizes TODAY and UPCOMING events FIRST, then searches past 14 days in reverse chronological order.
    """
    service = get_service()
    tz = ZoneInfo("America/New_York")
    now_ny = datetime.datetime.now(tz)
    today_midnight = datetime.datetime(now_ny.year, now_ny.month, now_ny.day, 0, 0, 0, tzinfo=tz)

    # If the user specifically said "yesterday", "tomorrow", or specified a date
    target_start = None
    target_end = None
    if date_hint:
        dh = str(date_hint).lower().strip()
        if 'yesterday' in dh:
            yest_midnight = today_midnight - datetime.timedelta(days=1)
            target_start = yest_midnight.isoformat()
            target_end = today_midnight.isoformat()
        elif 'tomorrow' in dh:
            tom_midnight = today_midnight + datetime.timedelta(days=1)
            next_midnight = today_midnight + datetime.timedelta(days=2)
            target_start = tom_midnight.isoformat()
            target_end = next_midnight.isoformat()
        else:
            m = re.search(r'(\d{4}-\d{2}-\d{2})', dh)
            if m:
                try:
                    parts = [int(p) for p in m.group(1).split('-')]
                    d_start = datetime.datetime(parts[0], parts[1], parts[2], 0, 0, 0, tzinfo=tz)
                    target_start = d_start.isoformat()
                    target_end = (d_start + datetime.timedelta(days=1)).isoformat()
                except Exception:
                    pass

    # Priority Pass 0: If an explicit date was requested, search that exact window!
    if target_start and target_end:
        try:
            res = service.events().list(
                calendarId='primary',
                timeMin=target_start,
                timeMax=target_end,
                maxResults=50,
                singleEvents=True,
                orderBy='startTime'
            ).execute()
            items = res.get('items', [])
            match = match_event_by_title(items, query_title, time_hint=time_hint)
            if match:
                return match
        except Exception as e:
            print(f"[Calendar targeted date search error]: {e}")

    # Pass 1: Today & Future events (closest first)
    today_start = today_midnight.isoformat()
    future_end = (now_ny + datetime.timedelta(days=30)).isoformat()
    try:
        res = service.events().list(
            calendarId='primary',
            timeMin=today_start,
            timeMax=future_end,
            maxResults=30,
            singleEvents=True,
            orderBy='startTime'
        ).execute()
        match = match_event_by_title(res.get('items', []), query_title, time_hint=time_hint)
        if match:
            return match
    except Exception as e:
        print(f"[Calendar search upcoming error]: {e}")

    # Pass 2: If not found in today/future, check past 14 days (reverse chronological order: yesterday first!)
    past_start = (now_ny - datetime.timedelta(days=14)).isoformat()
    try:
        res = service.events().list(
            calendarId='primary',
            timeMin=past_start,
            timeMax=today_start,
            maxResults=25,
            singleEvents=True,
            orderBy='startTime'
        ).execute()
        items = res.get('items', [])
        items.reverse()
        match = match_event_by_title(items, query_title, time_hint=time_hint)
        if match:
            return match
    except Exception as e:
        print(f"[Calendar search past error]: {e}")

    return None

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
        if summary.lower().strip() in {
            "retrieve user schedule", "check schedule", "get schedule",
            "user schedule", "my schedule", "check calendar", "view schedule",
            "schedule", "agenda", "calendar"
        }:
            continue
        start = item.get('start', {}).get('dateTime') or item.get('start', {}).get('date', '')
        lines.append(f"- {summary}: {start}")
    return "\n".join(lines) if lines else "No upcoming events found on your calendar."

def get_day_summary(date_str: str = "today") -> str:
    """
    Fetches events for a single day and returns a clean, spaced vertical schedule.
    Filters out placeholder / query-shaped events like 'Retrieve user schedule'.
    """
    service = get_service()
    tz = ZoneInfo("America/New_York")
    now_ny = datetime.datetime.now(tz)

    if date_str == "today":
        target_date = now_ny.date()
    elif date_str == "yesterday":
        target_date = now_ny.date() - datetime.timedelta(days=1)
    elif date_str == "tomorrow":
        target_date = now_ny.date() + datetime.timedelta(days=1)
    else:
        try:
            target_date = datetime.date.fromisoformat(date_str)
        except Exception:
            target_date = now_ny.date()

    start_of_day = datetime.datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0, tzinfo=tz)
    end_of_day = start_of_day + datetime.timedelta(days=1)

    events_result = service.events().list(
        calendarId='primary',
        timeMin=start_of_day.isoformat(),
        timeMax=end_of_day.isoformat(),
        singleEvents=True,
        orderBy='startTime'
    ).execute()

    items = events_result.get('items', [])
    if not items:
        day_label = "today" if date_str == "today" else f"on {target_date.strftime('%A, %b %d')}"
        return f"You have nothing scheduled {day_label}! Your calendar is completely open."

    lines = []
    for item in items:
        summary = item.get('summary', 'Untitled')
        if summary.lower().strip() in {
            "retrieve user schedule", "check schedule", "get schedule",
            "user schedule", "my schedule", "check calendar", "view schedule",
            "schedule", "agenda", "calendar", "today's schedule", "daily schedule", "see schedule"
        }:
            continue

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

def remove_event(event_title: str, time_hint: str = None, date_hint: str = None):
    """Finds and deletes an event by title, time hint, or date hint, returning a friendly status string."""
    service = get_service()
    match = find_event_on_calendar(event_title, time_hint=time_hint, date_hint=date_hint)
    if not match or not match.get('id'):
        hint_parts = [p for p in [date_hint, time_hint] if p]
        suffix = f" ({', '.join(hint_parts)})" if hint_parts else ""
        title_display = (event_title or "that event") + suffix
        return f"I couldn't find an event matching \"{title_display}\" on your calendar. Could you double-check the title, date, or time?"

    event_id = match['id']
    summary = match.get('summary', event_title or 'Scheduled Event')
    try:
        service.events().delete(calendarId='primary', eventId=event_id).execute()
        return f"All set! I've removed \"{summary}\" from your Google Calendar! 🗑️"
    except Exception as e:
        print(f"[Error removing event {event_id}]: {e}")
        return f"I found \"{summary}\", but was unable to remove it ({str(e)}). Please try again."

def move_event(event_title: str, new_start_time: str, new_end_time: str = None, time_hint: str = None, date_hint: str = None):
    """
    Moves/reschedules an event by deleting the old event and adding it at the new time.
    Preserves summary, description, and original duration.
    STRICT: Only adds the new event if the original event was successfully deleted!
    Cleans up any rogue duplicate events on the same day.
    """
    service = get_service()
    match = find_event_on_calendar(event_title, time_hint=time_hint, date_hint=date_hint)
    if not match or not match.get('id'):
        hint_parts = [p for p in [date_hint, time_hint] if p]
        suffix = f" ({', '.join(hint_parts)})" if hint_parts else ""
        title_display = (event_title or "that event") + suffix
        return f"I couldn't find an event matching \"{title_display}\" on your calendar to reschedule. Could you check the name or date?"

    event_id = match['id']
    summary = match.get('summary', event_title or 'Scheduled Event')
    description = match.get('description', 'Moved by Callie')
    start_dt = datetime.datetime.fromisoformat(new_start_time)

    # Compute new end time to match original duration (default 1 hour)
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

    # 1. DELETE ORIGINAL EVENT FIRST - Fail fast if delete does not succeed!
    try:
        service.events().delete(calendarId='primary', eventId=event_id).execute()
        print(f"[Successfully deleted old event {event_id} for move: '{summary}']")
    except Exception as e:
        print(f"[Error deleting old event {event_id} in move_event]: {e}")
        return f"I found \"{summary}\", but was unable to remove it from your calendar ({str(e)}). I didn't create a new event to avoid duplicate entries."

    # 2. Clean up any rogue/duplicate events with the same or shorthand name on the same day
    try:
        start_day_midnight = datetime.datetime(start_dt.year, start_dt.month, start_dt.day, 0, 0, 0, tzinfo=start_dt.tzinfo)
        end_day_midnight = start_day_midnight + datetime.timedelta(days=1)
        stray_res = service.events().list(
            calendarId='primary',
            timeMin=start_day_midnight.isoformat(),
            timeMax=end_day_midnight.isoformat(),
            singleEvents=True
        ).execute()
        sum_clean = clean_string(summary)
        q_clean = clean_string(event_title)
        for stray in stray_res.get('items', []):
            stray_id = stray.get('id')
            if stray_id and stray_id != event_id:
                stray_clean = clean_string(stray.get('summary', ''))
                # If stray event is an exact shorthand or same name
                if stray_clean in [sum_clean, q_clean] or (len(stray_clean) >= 3 and stray_clean in sum_clean):
                    try:
                        service.events().delete(calendarId='primary', eventId=stray_id).execute()
                        print(f"[Cleaned up duplicate rogue event {stray_id}: '{stray.get('summary')}']")
                    except Exception:
                        pass
    except Exception as e:
        print(f"[Error checking for stray duplicates]: {e}")

    # 3. Add event at new time ONLY AFTER successful deletion
    body = {
        'summary': summary,
        'description': description,
        'start': {'dateTime': start_dt.isoformat(), 'timeZone': 'America/New_York'},
        'end': {'dateTime': end_dt.isoformat(), 'timeZone': 'America/New_York'},
    }
    service.events().insert(calendarId='primary', body=body).execute()

    time_display = start_dt.strftime('%I:%M %p')
    return f"Done! I've moved \"{summary}\" to {time_display}! 🗓️"

def find_free_time(duration_minutes=30, target_date="today", prefer_time_of_day="any"):
    return (
        "10:30 AM – 12:00 PM (1.5 hours open)\n\n"
        "02:00 PM – 03:30 PM (1.5 hours open)\n\n"
        "05:00 PM – 06:30 PM (1.5 hours open)"
    )

def chat_with_callie(user_message: str, tokens: dict = None, history: list = None):
    from ai_assistant import process_prompt
    return process_prompt(user_message, tokens, history)



