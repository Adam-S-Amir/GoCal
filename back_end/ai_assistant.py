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

def build_system_instruction() -> str:
    now = datetime.datetime.now(ZoneInfo("America/New_York"))
    return f"""
    You are Callie, an energetic, cheerful, and witty calendar assistant for a college student.
    Current time: {now.strftime("%A, %B %d, %Y %I:%M %p")} (America/New_York).
    Your name is Callie.
    Tone: Friendly, encouraging, and witty.
    Formatting rules:
    - Keep answers clean, concise, and easy to read.
    - Format lists and schedules with line breaks and bullets.
    """

def safe_generate_content(client, prompt: str, fallback_text: str = "") -> str:
    """Retries 3 times on 503/429 spikes, and falls back to real calendar data if AI servers blip."""
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

def process_prompt(user_message: str, tokens: dict, history: list[dict] | None = None):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is missing from the .env file.", history or []

    client = genai.Client(api_key=api_key)
    reset_token = gemini_calander.set_tokens(tokens)

    msg_lower = user_message.lower().strip()
    now = datetime.datetime.now(ZoneInfo("America/New_York"))

    # Intent Detection
    is_create_intent = any(w in msg_lower for w in ["add", "create", "put", "schedule a", "book", "set an event", "set a meeting"])
    is_delete_intent = any(w in msg_lower for w in ["remove", "delete", "cancel"])
    is_free_time_query = any(w in msg_lower for w in ["free time", "open slot", "free slot", "open time", "when am i free"])
    is_schedule_query = any(w in msg_lower for w in [
        "schedule", "agenda", "plan", "calendar", "events", "what do i have", "whats on", "what's on", "whats my", "what's my"
    ]) and not is_create_intent and not is_delete_intent

    try:
        # 1. FREE TIME INTENT
        if is_free_time_query:
            target = "tomorrow" if "tomorrow" in msg_lower else "today"
            free_slots = gemini_calander.find_free_time(30, target, "any")
            prompt = f"""You are Callie. The user asked: "{user_message}".
Here is their real Google Calendar free slots data:
{free_slots}

Respond cheerfully in character as Callie and tell them when they are free with clean formatting:"""
            fallback = f"Here is what I found for your open slots:\n{free_slots}"
            reply = safe_generate_content(client, prompt, fallback_text=fallback)

        # 2. SCHEDULE INSPECTION INTENT
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

            prompt = f"""You are Callie. The user asked: "{user_message}".
Here is their actual live Google Calendar data:
{events}

Respond in character as Callie. Present their schedule cleanly with bullets and line breaks:"""
            fallback = f"Here is what's on your schedule for today:\n{events}"
            reply = safe_generate_content(client, prompt, fallback_text=fallback)

        # 3. ADD / SCHEDULE EVENT INTENT
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
                summary = event_data.get("summary", "New Event")
                start_time = event_data.get("start_time")
                end_time = event_data.get("end_time")
                if not end_time and start_time:
                    st = datetime.datetime.fromisoformat(start_time)
                    end_time = (st + datetime.timedelta(hours=1)).isoformat()

                gemini_calander.create_calendar_event(summary, start_time, end_time, "Created by Callie")
                st_formatted = datetime.datetime.fromisoformat(start_time).strftime("%I:%M %p")
                reply = f"All set! I've added '{summary}' for {st_formatted} to your Google Calendar! 🗓️"
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
        # Even on an unexpected exception, try to show the upcoming events directly
        try:
            events = gemini_calander.list_upcoming_events(5)
            return f"Here is what's coming up on your calendar:\n{events}", history or []
        except Exception:
            return "Hi! How can I help you organize your calendar today?", history or []

    finally:
        gemini_calander.reset_tokens(reset_token)