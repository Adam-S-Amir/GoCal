import os
import datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from google import genai
from google.genai import types
import gemini_calander

load_dotenv()

MODEL = "gemini-3.1-flash-lite"

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
    You are Callie, a fast, cheerful calendar assistant for a student.
    Current date & time: {now.strftime("%A, %B %d, %Y %I:%M %p")} (America/New_York).
    Your name is Callie. Be friendly, witty, and concise.
    
    IMPORTANT RULES:
    - If the user asks about their schedule, plans, or events, you MUST call list_upcoming_events or get_day_summary to inspect their Google Calendar.
    - If the user asks to schedule, book, or move an event, you MUST call the appropriate tool.
    - Format schedules cleanly with line breaks.
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

    try:
        chat = client.chats.create(
            model=MODEL,
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
        print(f"[Gemini Error]: {e}")
        error_msg = f"Sorry, I had trouble with that request: {e}"
        return error_msg, valid_history

    finally:
        gemini_calander.reset_tokens(reset_token)