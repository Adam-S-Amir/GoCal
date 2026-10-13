import os
import json
import re
import time
import datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from google import genai
import gemini_calander

load_dotenv()

MODEL = "gemini-3.1-flash-lite"

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
    """Retries up to 3 times on temporary 503/429 spikes, and falls back to real calendar data if needed."""
    for attempt in range(3):
        try:
            res = client.models.generate_content(model=MODEL, contents=prompt)
            if res and res.text:
                return res.text.strip()
        except Exception as e:
            err_str = str(e)
            if ("503" in err_str or "UNAVAILABLE" in err_str or "429" in err_str) and attempt < 2:
                time.sleep(1.0 * (attempt + 1))
                continue
            print(f"[Gemini 503 Spike on attempt {attempt+1}]: {err_str}")
            break
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
    if is_asking_for_schedule(msg_lower):
        return False

    create_verbs = [
        "add ", "add an ", "add a ", "put ", "book ", "set an event",
        "set a meeting", "create an event", "create event", "schedule a ",
        "schedule an ", "schedule gym", "schedule meeting", "schedule lunch",
        "schedule dinner", "schedule workout", "schedule study", "schedule class",
        "remind me to", "put on my calendar", "add to my calendar"
    ]
    return any(cv in msg_lower for cv in create_verbs)

def process_prompt(user_message: str, tokens: dict, history: list[dict] | None = None):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is missing from the .env file.", history or []

    client = genai.Client(api_key=api_key)
    reset_token = gemini_calander.set_tokens(tokens)
    msg_lower = user_message.lower().strip()
    now = datetime.datetime.now(ZoneInfo("America/New_York"))

    # Intent Detection
    is_delete_intent = any(w in msg_lower for w in ["remove", "delete", "cancel"]) and not is_asking_for_schedule(msg_lower)
    is_free_time_query = any(w in msg_lower for w in ["free time", "open slot", "free slot", "open time", "when am i free"])
    is_schedule_query = is_asking_for_schedule(msg_lower)
    is_create_intent = is_asking_to_create_event(msg_lower) and not is_schedule_query

    try:
        # 1. FREE TIME INTENT
        if is_free_time_query:
            target = "tomorrow" if "tomorrow" in msg_lower else "today"
            free_slots = gemini_calander.find_free_time(30, target, "any")
            prompt = f"""{build_system_instruction()}
User asked: "{user_message}".
Here is their real Google Calendar open slots data:
{free_slots}

Respond cheerfully in character as Callie and list their free slots vertically with clear spacing:"""
            fallback = f"Here is what I found for your open slots:\n\n{free_slots}"
            reply = safe_generate_content(client, prompt, fallback_text=fallback)

        # 2. SCHEDULE INSPECTION INTENT (Read query)
        elif is_schedule_query:
            if "tomorrow" in msg_lower:
                tomorrow_date = (now + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
                events = gemini_calander.get_day_summary(tomorrow_date)
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

        # 3. ADD / SCHEDULE EVENT INTENT (Write query)
        elif is_create_intent:
            extract_prompt = f"""Extract the event details from this user request.
Current time: {now.strftime("%A, %B %d, %Y %I:%M %p")} EDT.
User request: "{user_message}"
Output ONLY a raw JSON object with no markdown:
{{"summary": "Event Title", "start_time": "YYYY-MM-DDTHH:MM:SS-04:00", "end_time": "YYYY-MM-DDTHH:MM:SS-04:00"}}"""
            raw_text = safe_generate_content(client, extract_prompt, fallback_text="")
            if "```" in raw_text:
                raw_text = re.sub(r"```(json)?", "", raw_text).strip()

            try:
                event_data = json.loads(raw_text)
                summary = event_data.get("summary", "New Event").strip()

                # Safety check: Prevent creating dummy / hallucinated schedule queries
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
                    else:
                        reply = f"I'd love to schedule {summary} for you! What time and day would you like it booked?"
            except Exception:
                reply = "I'm ready to schedule that! Could you confirm the exact start time and day?"

        # 4. REMOVE / CANCEL EVENT INTENT
        elif is_delete_intent:
            extract_prompt = f"""Extract the event title to remove from: "{user_message}".
Output ONLY raw JSON: {{"title": "Title to remove"}}"""
            raw_text = safe_generate_content(client, extract_prompt, fallback_text="")
            if "```" in raw_text:
                raw_text = re.sub(r"```(json)?", "", raw_text).strip()
            try:
                data = json.loads(raw_text)
                title = data.get("title", "")
                reply = gemini_calander.remove_event(title)
            except Exception:
                reply = "Which event title would you like me to remove from your calendar?"

        # 5. GENERAL CONVERSATION & GREETINGS ("hi", "how are you", chat)
        else:
            context = ""
            if history:
                recent = [f"{t['role'].capitalize()}: {t['text']}" for t in history[-3:] if "error" not in t.get("text", "").lower()]
                context = "Recent conversation:\n" + "\n".join(recent) + "\n\n"

            prompt = f"{build_system_instruction()}\n\n{context}User: {user_message}\nCallie:"
            fallback = "Hi there! I'm Callie, your calendar assistant. How can I help you today?"
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