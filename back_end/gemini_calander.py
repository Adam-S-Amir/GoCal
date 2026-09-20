"""
Google Calendar tools exposed to Gemini.

Key changes vs. the original:
  * No `tokens` parameter on any tool. Gemini would otherwise see it in the
    generated schema and try to fill it. Tokens live in a contextvar that
    ai_assistant.process_prompt sets for the duration of one request.
  * Every function actually calls the Calendar API. No mocks.
"""

import datetime
import contextvars
from zoneinfo import ZoneInfo

from google_service import get_calendar_service

TZ_NAME = "America/New_York"
TZ = ZoneInfo(TZ_NAME)

# Workday window used when searching for free slots.
DAY_START_HOUR = 8
DAY_END_HOUR = 22

_tokens_var = contextvars.ContextVar("gocal_tokens", default=None)


def set_tokens(tokens: dict):
    """Called by ai_assistant before handing tools to Gemini. Returns a reset token."""
    return _tokens_var.set(tokens)


def reset_tokens(token) -> None:
    _tokens_var.reset(token)


def _service():
    tokens = _tokens_var.get()
    if not tokens:
        raise RuntimeError("User OAuth tokens missing. The user needs to visit /login.")
    return get_calendar_service(tokens)


# -------------------------------------------------------------------
# Internal helpers
# -------------------------------------------------------------------

def _now():
    return datetime.datetime.now(TZ)


def _parse(dt_string: str) -> datetime.datetime:
    """Parse an ISO 8601 string from Gemini. Assumes local TZ if naive."""
    dt = datetime.datetime.fromisoformat(dt_string.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt


def _day_bounds(date_str: str):
    d = datetime.date.fromisoformat(date_str)
    start = datetime.datetime.combine(d, datetime.time(0, 0), tzinfo=TZ)
    return start, start + datetime.timedelta(days=1)


def _events_for_day(service, date_str: str):
    start, end = _day_bounds(date_str)
    result = service.events().list(
        calendarId="primary",
        timeMin=start.isoformat(),
        timeMax=end.isoformat(),
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    return result.get("items", [])


def _busy_blocks(events):
    blocks = []
    for e in events:
        s = e["start"].get("dateTime")
        en = e["end"].get("dateTime")
        if not s or not en:          # all-day event, doesn't block time
            continue
        blocks.append((_parse(s).astimezone(TZ), _parse(en).astimezone(TZ)))
    return sorted(blocks)


def _open_gaps(date_str: str, blocks):
    d = datetime.date.fromisoformat(date_str)
    cursor = datetime.datetime.combine(d, datetime.time(DAY_START_HOUR), tzinfo=TZ)
    end_of_day = datetime.datetime.combine(d, datetime.time(DAY_END_HOUR), tzinfo=TZ)

    now = _now()
    if cursor < now < end_of_day:
        cursor = now

    gaps = []
    for start, end in blocks:
        if start > cursor:
            gaps.append((cursor, min(start, end_of_day)))
        cursor = max(cursor, end)
        if cursor >= end_of_day:
            break
    if cursor < end_of_day:
        gaps.append((cursor, end_of_day))
    return [(a, b) for a, b in gaps if b > a]


def _find_event(service, event_title: str):
    """Return the first upcoming event whose text matches event_title, or None."""
    result = service.events().list(
        calendarId="primary",
        q=event_title,
        timeMin=_now().isoformat(),
        singleEvents=True,
        orderBy="startTime",
        maxResults=10,
    ).execute()
    items = result.get("items", [])
    return items[0] if items else None


def _fmt(dt: datetime.datetime) -> str:
    return dt.strftime("%-I:%M %p") if hasattr(dt, "strftime") else str(dt)


def _fmt_win(dt: datetime.datetime) -> str:
    # Windows has no %-I, so format manually.
    hour = dt.hour % 12 or 12
    return f"{hour}:{dt.minute:02d} {'AM' if dt.hour < 12 else 'PM'}"


# -------------------------------------------------------------------
# Tools exposed to Gemini
# -------------------------------------------------------------------

def create_calendar_event(summary: str, start_time: str, end_time: str, description: str = "") -> str:
    """
    Creates a new event with a specific start and end time on the user's Google Calendar.
    This is the DEFAULT tool for scheduling anything that happens at a known time,
    including classes, study sessions, meetings, gym, and appointments.

    Args:
        summary: Title of the event (e.g., "Study session - MATH 2204").
        start_time: Start datetime in ISO 8601 format (e.g., "2026-09-20T15:00:00").
        end_time: End datetime in ISO 8601 format (e.g., "2026-09-20T16:30:00").
        description: Optional notes for the event body.
    """
    try:
        service = _service()
        body = {
            "summary": summary,
            "description": description,
            "start": {"dateTime": _parse(start_time).isoformat(), "timeZone": TZ_NAME},
            "end": {"dateTime": _parse(end_time).isoformat(), "timeZone": TZ_NAME},
        }
        created = service.events().insert(calendarId="primary", body=body).execute()
        return f"Created '{summary}'. Link: {created.get('htmlLink')}"
    except Exception as e:
        return f"Error creating event: {e}"


def list_upcoming_events(max_results: int = 5) -> str:
    """
    Retrieves the next few upcoming events from the user's Google Calendar.

    Args:
        max_results: How many events to return (default 5).
    """
    try:
        service = _service()
        result = service.events().list(
            calendarId="primary",
            timeMin=_now().isoformat(),
            maxResults=max_results,
            singleEvents=True,
            orderBy="startTime",
        ).execute()
        events = result.get("items", [])
        if not events:
            return "No upcoming events found."

        lines = []
        for e in events:
            start = e["start"].get("dateTime", e["start"].get("date"))
            lines.append(f"- {e.get('summary', 'Untitled')}: {start}")
        return "Upcoming events:\n" + "\n".join(lines)
    except Exception as e:
        return f"Error fetching events: {e}"


def remove_event(event_title: str) -> str:
    """
    Deletes or cancels an upcoming event, found by matching its title.

    Args:
        event_title: Name or keyword of the event to delete (e.g., "gym").
    """
    try:
        service = _service()
        event = _find_event(service, event_title)
        if not event:
            return f"No upcoming event matching '{event_title}' was found."
        service.events().delete(calendarId="primary", eventId=event["id"]).execute()
        return f"Removed '{event.get('summary')}' from the calendar."
    except Exception as e:
        return f"Error deleting event: {e}"


def make_time(activity: str, duration_minutes: int = 60, preferred_date: str = "") -> str:
    """
    Finds the first open gap on a given day and books dedicated time for a task.
    Use this only when the user has NOT given a specific start time.

    Args:
        activity: What the time is for (e.g., "Study for CS 1114").
        duration_minutes: How long the block should be.
        preferred_date: Date as YYYY-MM-DD. Defaults to today.
    """
    try:
        if not preferred_date:
            preferred_date = _now().strftime("%Y-%m-%d")

        service = _service()
        gaps = _open_gaps(preferred_date, _busy_blocks(_events_for_day(service, preferred_date)))
        need = datetime.timedelta(minutes=duration_minutes)

        for start, end in gaps:
            if end - start >= need:
                return create_calendar_event(
                    summary=activity,
                    start_time=start.isoformat(),
                    end_time=(start + need).isoformat(),
                    description="Auto-scheduled focus time",
                )
        return f"No open {duration_minutes}-minute slot on {preferred_date} between {DAY_START_HOUR}:00 and {DAY_END_HOUR}:00."
    except Exception as e:
        return f"Error finding time: {e}"


def due_dates(task_name: str, due_date: str, course_name: str = "") -> str:
    """
    Adds an ALL-DAY deadline marker for an assignment. Use this only for due dates
    with no specific time of day. If the user gives a time, use create_calendar_event.

    Args:
        task_name: Name of the assignment or task (e.g., "Project 1 Submission").
        due_date: Due date as YYYY-MM-DD.
        course_name: Optional course code (e.g., "MATH 2204").
    """
    try:
        service = _service()
        title = f"DUE: {course_name} - {task_name}" if course_name else f"DUE: {task_name}"
        d = datetime.date.fromisoformat(due_date)
        body = {
            "summary": title,
            "start": {"date": d.isoformat()},
            "end": {"date": (d + datetime.timedelta(days=1)).isoformat()},
            "reminders": {
                "useDefault": False,
                "overrides": [{"method": "popup", "minutes": 12 * 60}],
            },
        }
        created = service.events().insert(calendarId="primary", body=body).execute()
        return f"Added all-day deadline '{title}' on {due_date}. Link: {created.get('htmlLink')}"
    except Exception as e:
        return f"Error creating deadline: {e}"


def move_event(event_title: str, new_start_time: str, new_duration_minutes: int = 0) -> str:
    """
    Reschedules an existing event to a new date and time.

    Args:
        event_title: Name or keyword of the event to move (e.g., "gym").
        new_start_time: New start datetime in ISO 8601 format.
        new_duration_minutes: New length in minutes. Pass 0 to keep the original length.
    """
    try:
        service = _service()
        event = _find_event(service, event_title)
        if not event:
            return f"No upcoming event matching '{event_title}' was found."
        if "dateTime" not in event["start"]:
            return f"'{event.get('summary')}' is an all-day event and has no time to move."

        old_start = _parse(event["start"]["dateTime"])
        old_end = _parse(event["end"]["dateTime"])
        duration = (datetime.timedelta(minutes=new_duration_minutes)
                    if new_duration_minutes else old_end - old_start)

        new_start = _parse(new_start_time)
        patch = {
            "start": {"dateTime": new_start.isoformat(), "timeZone": TZ_NAME},
            "end": {"dateTime": (new_start + duration).isoformat(), "timeZone": TZ_NAME},
        }
        updated = service.events().patch(
            calendarId="primary", eventId=event["id"], body=patch
        ).execute()
        return f"Moved '{updated.get('summary')}' to {new_start.strftime('%A, %B %d')} at {_fmt_win(new_start)}."
    except Exception as e:
        return f"Error moving event: {e}"


def get_day_summary(target_date: str) -> str:
    """
    Lists everything scheduled on one specific day.

    Args:
        target_date: Date as YYYY-MM-DD.
    """
    try:
        service = _service()
        events = _events_for_day(service, target_date)
        if not events:
            return f"Nothing scheduled on {target_date}."

        lines = []
        for e in events:
            if "dateTime" in e["start"]:
                s = _parse(e["start"]["dateTime"]).astimezone(TZ)
                en = _parse(e["end"]["dateTime"]).astimezone(TZ)
                lines.append(f"- {e.get('summary', 'Untitled')}: {_fmt_win(s)} to {_fmt_win(en)}")
            else:
                lines.append(f"- {e.get('summary', 'Untitled')}: all day")
        return f"Schedule for {target_date}:\n" + "\n".join(lines)
    except Exception as e:
        return f"Error building day summary: {e}"


def find_free_time(duration_minutes: int, target_date: str, prefer_time_of_day: str = "any") -> str:
    """
    Finds open slots on a day that are long enough for a task. Does not book anything.

    Args:
        duration_minutes: Length of time needed.
        target_date: Date as YYYY-MM-DD.
        prefer_time_of_day: "morning", "afternoon", "evening", or "any".
    """
    try:
        service = _service()
        gaps = _open_gaps(target_date, _busy_blocks(_events_for_day(service, target_date)))
        need = datetime.timedelta(minutes=duration_minutes)

        ranges = {"morning": (0, 12), "afternoon": (12, 17), "evening": (17, 24)}
        lo, hi = ranges.get(prefer_time_of_day.lower(), (0, 24))

        usable = []
        for start, end in gaps:
            if end - start < need:
                continue
            if not (lo <= start.hour < hi or lo <= (end.hour or 24) <= hi):
                continue
            usable.append(f"{_fmt_win(start)} to {_fmt_win(end)}")

        if not usable:
            return f"No {duration_minutes}-minute openings on {target_date}."
        return f"Open slots on {target_date}: " + "; ".join(usable)
    except Exception as e:
        return f"Error finding free time: {e}"


def update_event_details(event_title: str, location: str = "", description: str = "", new_title: str = "") -> str:
    """
    Updates the non-time details of an event: location, notes, or title.
    Do NOT use this to change start or end times. Use move_event for that.

    Args:
        event_title: Current name of the event to find.
        location: New location (e.g., "Newman Library Room 201").
        description: New notes or description.
        new_title: New title, if renaming.
    """
    try:
        service = _service()
        event = _find_event(service, event_title)
        if not event:
            return f"No upcoming event matching '{event_title}' was found."

        patch = {}
        if location:
            patch["location"] = location
        if description:
            patch["description"] = description
        if new_title:
            patch["summary"] = new_title
        if not patch:
            return "Nothing to update. Provide a location, description, or new title."

        updated = service.events().patch(
            calendarId="primary", eventId=event["id"], body=patch
        ).execute()
        return f"Updated '{updated.get('summary')}'. Link: {updated.get('htmlLink')}"
    except Exception as e:
        return f"Error updating event: {e}"