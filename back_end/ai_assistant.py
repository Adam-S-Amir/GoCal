import os
import time
import datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from google import genai
from google.genai import types
import gemini_calander

load_dotenv()

# gemini-3.1-flash-lite has high availability and responds in under 1 second
PRIMARY_MODEL = "gemini-3.1-flash-lite"
FALLBACK_MODEL = "gemini-3.8-flash"

CALENDAR_TOOLS = [
    gemini_calander.create_calendar_event,
    gemini_calander.list_upcoming_events,
    gemini_calander.remove_event,
    gemini_calander.make_time,
    gemini_calander.due_dates,
    gemini_calander.move_event,
    gemini_calander.get_day_summary,
    gemini_calander.find_free_time,
    gemini_calander.update_event_details,
]

def build_system_instruction() -> str:
    now = datetime.datetime.now(ZoneInfo("America/New_York"))
    return f"""
    You are Callie, an energetic, cheerful, and witty calendar assistant for a student.
    Current date & time: {now.strftime("%A, %B %d, %Y %I:%M %p")} (America/New_York).
    Your name is Callie. Be friendly, helpful, and concise with clean line breaks for schedules.
    When asked about schedules, check calendar tools first. If it's a general greeting, respond warmly without calling tools.
    """

def process_prompt(user_message: str, tokens: dict, history: list[dict] | None = None):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is missing from the .env file.", history or []

    client = genai.Client(api_key=api_key)
    reset_token = gemini_calander.set_tokens(tokens)

    prompt = user_message
    valid_history = [
        t for t in (history or [])
        if "error" not in t.get("text", "").lower() and "invalid_argument" not in t.get("text", "").lower()
    ]
    if valid_history:
        recent_turns = [f"{t['role'].capitalize()}: {t['text']}" for t in valid_history[-3:]]
        if recent_turns:
            context_str = "\n".join(recent_turns)
            prompt = f"Previous context:\n{context_str}\n\nUser: {user_message}"

    # Try fast model first, then fallback model
    models_to_try = [PRIMARY_MODEL, FALLBACK_MODEL]

    for m in models_to_try:
        try:
            chat = client.chats.create(
                model=m,
                config=types.GenerateContentConfig(
                    system_instruction=build_system_instruction(),
                    tools=CALENDAR_TOOLS,
                    temperature=0.1,
                )
            )

            response = chat.send_message(prompt)
            reply = response.text or "I've checked and updated your calendar!"

            new_history = list(valid_history)
            new_history.append({"role": "user", "text": user_message})
            new_history.append({"role": "model", "text": reply})
            return reply, new_history

        except Exception as e:
            print(f"[Model {m} failed]: {e}")
            time.sleep(0.5)
            continue

    # Graceful fallback: Still answers conversationally so the user is NEVER blocked
    try:
        fallback_res = client.models.generate_content(
            model=PRIMARY_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=build_system_instruction(),
                temperature=0.3,
            )
        )
        reply = fallback_res.text or "Hi! I'm Callie, how can I help you organize your calendar today?"
        new_history = list(valid_history)
        new_history.append({"role": "user", "text": user_message})
        new_history.append({"role": "model", "text": reply})
        return reply, new_history
    except Exception:
        return "Hi there! I'm Callie, your calendar assistant. How can I help you today?", valid_history

    finally:
        gemini_calander.reset_tokens(reset_token)