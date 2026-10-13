import os
import json
import re
import datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from google import genai
import gemini_calander

load_dotenv()

# Zero-cost production models on Google GenAI:
# gemini-3.8-flash is the modern standard model for text tasks & reasoning.
# gemini-3.1-flash-lite is the ultra-fast lightweight model.
PRIMARY_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
CANDIDATE_MODELS = [
    PRIMARY_MODEL,
    "gemini-3.8-flash",
    "gemini-3.1-flash-lite",
]

_genai_client = None

def get_genai_client(api_key: str):
    global _genai_client
    if _genai_client is None:
        _genai_client = genai.Client(api_key=api_key)
    return _genai_client

FORBIDDEN_SUMMARIES = {
    "retrieve user schedule",
    "check schedule",
    "get schedule",
    "user schedule",
    "my schedule",
    "check calendar",
    "view schedule",
    "schedule",
    "agenda",
    "calendar",
    "today's schedule",
    "daily schedule",
    "see schedule",
}

def build_system_instruction() -> str:
    now = datetime.datetime.now(ZoneInfo("America/New_York"))
    return f"""You are Callie, an energetic, cheerful, and witty calendar assistant for college students and busy people.
Current time: {now.strftime("%A, %B %d, %Y %I:%M %p")} (America/New_York).
Your name is Callie.
Tone: Friendly, encouraging, witty, and organized.

CRITICAL INTENT RULES (READ vs WRITE):
- The word "schedule" is very often a NOUN: "what's my schedule", "whats on the schedule", "my schedule today", "agenda", "what am i doing today". These are READ operations. NEVER create an event when someone asks about their schedule.
- ONLY create an event when the user explicitly commands you to ADD or BOOK a specific new activity (e.g. "Add CS lecture at 2pm", "Schedule gym tomorrow at 6pm").
- NEVER invent placeholder event names like "Retrieve user schedule", "Check calendar", or "Schedule".

FORMATTING RULES FOR SCHEDULES (SPACED VERTICAL COLUMN, NO RAW ASTERISKS):
- NEVER output a dense block or clump of text.
- NEVER use raw asterisks like '*' for list items.
- Always display daily schedules as a clean, spacious vertical column with a blank line between every item.
- For each scheduled event, use this clean column format:
  [START TIME] – [END TIME] | [EVENT TITLE] ([LOCATION or NOTES if available])
- Example layout:
  09:00 AM – 10:15 AM | CS 3110 Lecture (Hall B)

  12:30 PM – 01:30 PM | Lunch with Sarah (Campus Center)

  04:00 PM – 05:15 PM | Gym Workout (Upper Body)

  07:30 PM – 08:30 PM | Study Session (Library 3rd Floor)
- Keep opening and closing commentary friendly and brief so the schedule column stands out clearly.
"""

def safe_generate_content(client, prompt: str, fallback_text: str = "") -> str:
    """Direct, fast execution using production models with immediate failover."""
    seen = set()
    models = []
    for m in CANDIDATE_MODELS:
        if m and m not in seen:
            seen.add(m)
            models.append(m)

    for model_name in models:
        try:
            res = client.models.generate_content(model=model_name, contents=prompt)
            if res and res.text:
                return res.text.strip()
        except Exception as e:
            print(f"[Gemini model '{model_name}' error]: {e}")
            continue

    return fallback_text

def is_asking_for_schedule(msg_lower: str) -> bool:
    """Detect if user is querying their schedule (read operation)."""
    read_indicators = [
        "what", "whats", "what's", "show", "view", "check", "see",
        "how does", "look like", "agenda", "plan", "doing", "have going",
        "tell me", "calendar", "again", "today", "tomorrow"
    ]
    if "schedule" in msg_lower:
        if any(p in msg_lower for p in ["my schedule", "the schedule", "a schedule", "our schedule", "today's schedule"]):
            return True
        if any(ind in msg_lower for ind in ["what", "whats", "what's", "check", "show", "see", "view", "again"]):
            return True

    return any(p in msg_lower for p in [
        "whats on", "what's on", "whats my", "what's my", "what do i have",
        "what am i doing", "what am i up to", "my agenda", "upcoming events",
        "any plans", "check calendar", "view calendar", "today's plan"
    ])

def is_asking_to_create_event(msg_lower: str) -> bool:
    """Strictly detect if user wants to ADD a new event (write operation)."""
    if is_asking_for_schedule(msg_lower) and not any(k in msg_lower for k in ["add", "book", "create", "put"]):
        return False

    create_verbs = [
        "add ", "add an ", "add a ", "put ", "book ", "set an event",
        "set a meeting", "create an event", "create event", "schedule a ",
        "schedule an ", "schedule gym", "schedule meeting", "schedule lunch",
        "schedule dinner", "schedule workout", "schedule study", "schedule class",
        "remind me to", "put on my calendar", "add to my calendar"
    ]
    return any(cv in msg_lower for cv in create_verbs)

def parse_target_datetime(text: str, now: datetime.datetime) -> str | None:
    """
    Deterministically parses natural times like '8pm', '9:30 am', 'tomorrow at 10pm',
    'yesterday at 4pm', 'at 8' into an ISO-8601 string in America/New_York.
    """
    if not text:
        return None
    t = text.lower().strip()

    target_date = now.date()
    if "tomorrow" in t:
        target_date = target_date + datetime.timedelta(days=1)
    elif "yesterday" in t:
        target_date = target_date - datetime.timedelta(days=1)

    time_match = re.search(r'\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b', t)
    if not time_match:
        return None

    hour = int(time_match.group(1))
    minute = int(time_match.group(2)) if time_match.group(2) else 0
    ampm = time_match.group(3)

    if ampm == 'pm' and hour < 12:
        hour += 12
    elif ampm == 'am' and hour == 12:
        hour = 0
    elif not ampm:
        if 1 <= hour <= 6:
            hour += 12
        elif 7 <= hour <= 11 and "morning" not in t:
            hour += 12

    try:
        target_dt = datetime.datetime(
            target_date.year, target_date.month, target_date.day,
            hour, minute, 0, tzinfo=now.tzinfo
        )
        return target_dt.isoformat()
    except Exception:
        return None

def extract_agenda_from_history(history: list[dict] | None) -> list[dict]:
    """
    Extracts scheduled events listed in prior assistant schedule messages.
    Returns: [{'title': 'Study Spanish', 'time': '06:00 PM', ...}, ...]
    """
    events = []
    if not history:
        return events
    for turn in reversed(history):
        text = turn.get("text", "")
        # Matches lines like: 06:00 PM – 07:00 PM | Study Spanish (Room 101)
        matches = re.findall(r'(\d{1,2}:\d{2}\s*[AP]M)\s*[–-]\s*\d{1,2}:\d{2}\s*[AP]M\s*\|\s*([^(\n\r]+)', text)
        if matches:
            for time_str, title_str in matches:
                clean_title = title_str.strip()
                if clean_title and clean_title.lower() not in FORBIDDEN_SUMMARIES:
                    events.append({'title': clean_title, 'time': time_str.strip()})
            if events:
                break
    return events

def extract_last_referenced_event(history: list[dict] | None) -> str:
    """
    Scans conversation history in reverse to find the most recently discussed event title.
    """
    if not history:
        return ""
    for turn in reversed(history):
        text = turn.get("text", "")
        # Check double-quoted titles in assistant responses: I've moved "Study Spanish" or removed "Gym"
        quoted = re.findall(r'"([^"]+)"', text)
        for q in quoted:
            if len(q) >= 2 and q.lower() not in {"it", "that", "primary", "today", "tomorrow"}:
                return q

        # Check user commands: move spanish to 8pm, delete study spanish
        m = re.search(r'\b(?:move|reschedule|delete|remove|cancel|add)\s+([a-zA-Z0-9\s]+?)(?:\s+(?:to|at|\d{1,2}|tomorrow|today|yesterday|$))', text, re.IGNORECASE)
        if m:
            candidate = m.group(1).strip()
            if candidate and candidate.lower() not in {"it", "that", "the event", "an event", "this", "my", "a", "an"}:
                return candidate
    return ""

def resolve_event_from_context(user_query: str, history: list[dict] | None) -> tuple[str, str | None]:
    """
    Resolves a shorthand or pronoun ('spanish', 'study', 'gym', 'it', 'that')
    to the full calendar event title and original time hint using recent conversation history.
    Returns: (resolved_title, orig_time_hint)
    """
    q_raw = (user_query or "").strip()
    q_clean = gemini_calander.clean_string(q_raw)

    # 1. Pronoun resolution ('it', 'that', 'this event')
    last_ev = extract_last_referenced_event(history)
    if q_clean in {"it", "that", "this", "event", "the event", "that event"}:
        return (last_ev or q_raw, None)

    # 2. Match against events displayed in recent schedule
    agenda = extract_agenda_from_history(history)
    if agenda and q_clean:
        # Check exact word containment (e.g. 'spanish' in 'Study Spanish')
        for item in agenda:
            ev_clean = gemini_calander.clean_string(item['title'])
            if q_clean == ev_clean:
                return (item['title'], item['time'])

        for item in agenda:
            ev_clean = gemini_calander.clean_string(item['title'])
            ev_words = ev_clean.split()
            # If the user's query word matches any word in the event title (e.g. 'spanish' in ['study', 'spanish'])
            if q_clean in ev_words or any(q_clean in w for w in ev_words if len(q_clean) >= 3):
                return (item['title'], item['time'])

        for item in agenda:
            ev_clean = gemini_calander.clean_string(item['title'])
            if q_clean in ev_clean or ev_clean in q_clean:
                return (item['title'], item['time'])

    return (q_raw, None)

def process_prompt(user_message: str, tokens: dict, history: list[dict] | None = None):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is missing from the .env file.", history or []

    client = get_genai_client(api_key)
    reset_token = gemini_calander.set_tokens(tokens)
    msg_lower = user_message.lower().strip()
    now = datetime.datetime.now(ZoneInfo("America/New_York"))

    last_event = extract_last_referenced_event(history)
    last_model_turn = ""
    if history:
        for t in reversed(history):
            if t.get("role") in ["model", "assistant"]:
                last_model_turn = t.get("text", "")
                break

    # Follow-up detection for multi-turn prompts:
    # 1. User answers a time question like "9pm"
    is_answering_move_time = (
        ("new date and time" in last_model_turn.lower() or "what new time" in last_model_turn.lower() or "reschedule" in last_model_turn.lower())
        and bool(re.search(r'\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|tomorrow|today|yesterday|at\s+\d{1,2})\b', msg_lower))
        and len(msg_lower.split()) <= 6
    )

    # 2. User answers a delete event question like "spanish"
    is_answering_delete_title = (
        ("remove from your calendar" in last_model_turn.lower() or "like me to remove" in last_model_turn.lower())
        and len(msg_lower.split()) <= 5
        and not any(w in msg_lower for w in ["hi", "hello", "hey", "what", "how"])
    )

    # Check if user asked to also view their schedule after the action
    show_schedule_too = bool(re.search(r'\b(and\s+(?:tell|show|view|check|give)\s+(?:me\s+)?(?:my\s+)?schedule|schedule\s+again)\b', msg_lower))

    try:
        # =========================================================================
        # 1. FAST-PATH: MULTI-TURN FOLLOW-UP ANSWERS
        # =========================================================================
        if is_answering_move_time and last_event:
            new_start = parse_target_datetime(user_message, now)
            if new_start:
                resolved_title, orig_time = resolve_event_from_context(last_event, history)
                reply = gemini_calander.move_event(resolved_title, new_start, time_hint=orig_time)
                if show_schedule_too:
                    today_summary = gemini_calander.get_day_summary("today")
                    reply += f"\n\nHere is what's on your schedule now:\n\n{today_summary}"
                new_hist = list(history or [])
                new_hist.append({"role": "user", "text": user_message})
                new_hist.append({"role": "model", "text": reply})
                return reply, new_hist

        if is_answering_delete_title:
            resolved_title, orig_time = resolve_event_from_context(user_message, history)
            reply = gemini_calander.remove_event(resolved_title, time_hint=orig_time)
            if show_schedule_too:
                today_summary = gemini_calander.get_day_summary("today")
                reply += f"\n\nHere is what's on your schedule now:\n\n{today_summary}"
            new_hist = list(history or [])
            new_hist.append({"role": "user", "text": user_message})
            new_hist.append({"role": "model", "text": reply})
            return reply, new_hist

        # =========================================================================
        # 2. FAST-PATH: DIRECT MOVE / RESCHEDULE COMMANDS (Instant Execution)
        # =========================================================================
        # Matches commands like: "move spanish to 8pm", "reschedule study spanish to 9pm", "move it to 9pm"
        move_regex = re.search(
            r'^\s*(?:please\s+)?(?:move|reschedule|shift|postpone|change\s+the\s+time\s+of)\s+(.+?)\s+(?:to|at)\s+(.+?)(?:\s+and\s+.*)?$',
            msg_lower,
            re.IGNORECASE
        )
        if move_regex:
            raw_target = move_regex.group(1).strip()
            raw_time = move_regex.group(2).strip()
            resolved_title, orig_time = resolve_event_from_context(raw_target, history)
            new_start = parse_target_datetime(raw_time, now)
            if new_start:
                reply = gemini_calander.move_event(resolved_title, new_start, time_hint=orig_time)
                if show_schedule_too:
                    today_summary = gemini_calander.get_day_summary("today")
                    reply += f"\n\nHere is what's on your schedule now:\n\n{today_summary}"
                new_hist = list(history or [])
                new_hist.append({"role": "user", "text": user_message})
                new_hist.append({"role": "model", "text": reply})
                return reply, new_hist

        # Check for move intent without target time: "move spanish", "reschedule study session"
        move_notime_regex = re.search(
            r'^\s*(?:please\s+)?(?:move|reschedule|shift)\s+([a-zA-Z0-9\s]+?)\s*$',
            msg_lower,
            re.IGNORECASE
        )
        if move_notime_regex and not any(w in msg_lower for w in ["to", "at", "pm", "am"]):
            target_str = move_notime_regex.group(1).strip()
            resolved_title, _ = resolve_event_from_context(target_str, history)
            reply = f"I'd love to reschedule \"{resolved_title}\" for you! What new time and date should I move it to?"
            new_hist = list(history or [])
            new_hist.append({"role": "user", "text": user_message})
            new_hist.append({"role": "model", "text": reply})
            return reply, new_hist

        # =========================================================================
        # 3. FAST-PATH: DIRECT REMOVE / DELETE COMMANDS (Instant Execution)
        # =========================================================================
        # Matches: "delete spanish", "remove study spanish", "cancel gym", "remove it"
        delete_regex = re.search(
            r'^\s*(?:please\s+)?(?:remove|delete|cancel|drop|take\s+off|erase)\s+(.+?)(?:\s+and\s+.*)?$',
            msg_lower,
            re.IGNORECASE
        )
        if delete_regex and not any(w in msg_lower for w in ["to ", "at "]):
            raw_target = delete_regex.group(1).strip()
            resolved_title, orig_time = resolve_event_from_context(raw_target, history)
            reply = gemini_calander.remove_event(resolved_title, time_hint=orig_time)
            if show_schedule_too:
                today_summary = gemini_calander.get_day_summary("today")
                reply += f"\n\nHere is what's on your schedule now:\n\n{today_summary}"
            new_hist = list(history or [])
            new_hist.append({"role": "user", "text": user_message})
            new_hist.append({"role": "model", "text": reply})
            return reply, new_hist

        # =========================================================================
        # 4. SCHEDULE INSPECTION INTENT (Read query)
        # =========================================================================
        has_move_verbs = bool(re.search(r'\b(move|reschedule|postpone|shift|push back|change the time)\b', msg_lower))
        has_delete_verbs = bool(re.search(r'\b(remove|delete|cancel|drop|erase)\b', msg_lower))
        is_schedule_query = is_asking_for_schedule(msg_lower) and not has_move_verbs and not has_delete_verbs

        if is_schedule_query:
            if "tomorrow" in msg_lower:
                tomorrow_date = (now + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
                events = gemini_calander.get_day_summary(tomorrow_date)
            elif "yesterday" in msg_lower:
                yesterday_date = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
                events = gemini_calander.get_day_summary(yesterday_date)
            elif "week" in msg_lower:
                events = gemini_calander.list_upcoming_events(10)
            else:
                events = gemini_calander.get_day_summary("today")
                if "nothing scheduled" in events.lower():
                    upcoming = gemini_calander.list_upcoming_events(5)
                    events = f"Nothing scheduled for today.\nUpcoming items:\n{upcoming}"

            prompt = f"""{build_system_instruction()}
User asked: "{user_message}".
Here is their actual live Google Calendar data:
{events}

Respond in character as Callie. Lay out their schedule in a clean vertical column with an empty line between each event. Do not use raw asterisks:"""
            fallback = f"Here is what's on your schedule:\n\n{events}"
            reply = safe_generate_content(client, prompt, fallback_text=fallback)
            new_hist = list(history or [])
            new_hist.append({"role": "user", "text": user_message})
            new_hist.append({"role": "model", "text": reply})
            return reply, new_hist

        # =========================================================================
        # 5. GENERAL / COMPLEX MOVE INTENT (Gemini Fallback)
        # =========================================================================
        if has_move_verbs:
            agenda = extract_agenda_from_history(history)
            agenda_context = ""
            if agenda:
                agenda_context = "Current schedule items: " + ", ".join([f"{a['title']} ({a['time']})" for a in agenda]) + "\n"

            extract_prompt = f"""Extract details to reschedule a Google Calendar event.
Current time: {now.strftime("%A, %B %d, %Y %I:%M %p")} America/New_York.
{agenda_context}User request: "{user_message}"

Output ONLY a raw JSON object:
{{"title": "Exact Event Title", "original_time": "6:00 PM or null", "new_start_time": "YYYY-MM-DDTHH:MM:SS-04:00"}}"""
            raw_text = safe_generate_content(client, extract_prompt, fallback_text="")
            title = ""
            orig_time = None
            new_start = None

            if raw_text:
                try:
                    clean_raw = re.sub(r"```(json)?", "", raw_text).replace("```", "").strip()
                    json_match = re.search(r"\{.*\}", clean_raw, re.DOTALL)
                    data = json.loads(json_match.group(0)) if json_match else json.loads(clean_raw)
                    title = data.get("title", "").strip()
                    orig_time = data.get("original_time")
                    new_start = data.get("new_start_time", "").strip()
                except Exception as e:
                    print(f"[Move intent JSON parse error]: {e}")

            if not title:
                title, orig_time = resolve_event_from_context(user_message, history)
            else:
                title, hist_time = resolve_event_from_context(title, history)
                orig_time = orig_time or hist_time

            if not new_start:
                new_start = parse_target_datetime(user_message, now)

            if new_start:
                reply = gemini_calander.move_event(title, new_start, time_hint=orig_time)
                if show_schedule_too:
                    today_summary = gemini_calander.get_day_summary("today")
                    reply += f"\n\nHere is what's on your schedule now:\n\n{today_summary}"
            else:
                reply = f"I'd love to reschedule \"{title}\" for you! What new time and date should I move it to?"

            new_hist = list(history or [])
            new_hist.append({"role": "user", "text": user_message})
            new_hist.append({"role": "model", "text": reply})
            return reply, new_hist

        # =========================================================================
        # 6. GENERAL / COMPLEX DELETE INTENT (Gemini Fallback)
        # =========================================================================
        if has_delete_verbs:
            title, orig_time = resolve_event_from_context(user_message, history)
            reply = gemini_calander.remove_event(title, time_hint=orig_time)
            if show_schedule_too:
                today_summary = gemini_calander.get_day_summary("today")
                reply += f"\n\nHere is what's on your schedule now:\n\n{today_summary}"
            new_hist = list(history or [])
            new_hist.append({"role": "user", "text": user_message})
            new_hist.append({"role": "model", "text": reply})
            return reply, new_hist

        # =========================================================================
        # 7. ADD / SCHEDULE EVENT INTENT (Write query)
        # =========================================================================
        if is_asking_to_create_event(msg_lower):
            extract_prompt = f"""Extract the event details from this user request.
Current time: {now.strftime("%A, %B %d, %Y %I:%M %p")} America/New_York.
User request: "{user_message}"
Output ONLY a raw JSON object:
{{"summary": "Event Title", "start_time": "YYYY-MM-DDTHH:MM:SS-04:00", "end_time": "YYYY-MM-DDTHH:MM:SS-04:00"}}"""
            raw_text = safe_generate_content(client, extract_prompt, fallback_text="")
            clean_raw = re.sub(r"```(json)?", "", raw_text).replace("```", "").strip() if raw_text else ""

            try:
                json_match = re.search(r"\{.*\}", clean_raw, re.DOTALL)
                event_data = json.loads(json_match.group(0)) if json_match else json.loads(clean_raw)
                summary = event_data.get("summary", "New Event").strip()

                if summary.lower() in FORBIDDEN_SUMMARIES or "schedule" in summary.lower():
                    events = gemini_calander.get_day_summary("today")
                    reply = f"Here is what is currently on your schedule:\n\n{events}"
                else:
                    start_time = event_data.get("start_time")
                    end_time = event_data.get("end_time")
                    if not end_time and start_time:
                        st = datetime.datetime.fromisoformat(start_time)
                        end_time = (st + datetime.timedelta(hours=1)).isoformat()

                    if start_time and end_time:
                        gemini_calander.create_calendar_event(summary, start_time, end_time, "Created by Callie")
                        st_formatted = datetime.datetime.fromisoformat(start_time).strftime("%I:%M %p")
                        reply = f"All set! I've added {summary} for {st_formatted} to your Google Calendar! 🗓️"
                        if show_schedule_too:
                            today_summary = gemini_calander.get_day_summary("today")
                            reply += f"\n\nHere is your updated schedule:\n\n{today_summary}"
                    else:
                        reply = f"I'd love to schedule {summary} for you! What time and day would you like it booked?"
            except Exception:
                reply = "I'm ready to schedule that! Could you confirm the exact start time and day?"

            new_hist = list(history or [])
            new_hist.append({"role": "user", "text": user_message})
            new_hist.append({"role": "model", "text": reply})
            return reply, new_hist

        # =========================================================================
        # 8. GENERAL CONVERSATION & GREETINGS ("hi", "how are you", chat)
        # =========================================================================
        context = ""
        if history:
            recent = [f"{t['role'].capitalize()}: {t['text']}" for t in history[-4:] if "error" not in t.get("text", "").lower()]
            context = "Recent conversation:\n" + "\n".join(recent) + "\n\n"

        prompt = f"{build_system_instruction()}\n\n{context}User: {user_message}\nCallie:"
        fallback = "Hi there! I'm Callie, your calendar assistant. How can I help you organize your day?"
        reply = safe_generate_content(client, prompt, fallback_text=fallback)

        new_history = list(history or [])
        new_history.append({"role": "user", "text": user_message})
        new_history.append({"role": "model", "text": reply})
        return reply, new_history

    except Exception as e:
        print(f"[Callie Error]: {e}")
        try:
            events = gemini_calander.list_upcoming_events(5)
            return f"Here is what's coming up on your calendar:\n\n{events}", history or []
        except Exception:
            return "Hi! How can I help you organize your calendar today?", history or []
    finally:
        gemini_calander.reset_tokens(reset_token)
