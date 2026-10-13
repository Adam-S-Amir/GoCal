import os
import time
import datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from google import genai
from google.genai import types
import gemini_calander

load_dotenv()

# Fast, load-balanced model alias
MODEL = "gemini-flash-latest"

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
    # Streamlined prompt: cuts prompt prefill tokens in half for fast generation
    return f"""
    You are Callie, a fast, cheerful calendar assistant for a student.
    Current time: {now.strftime("%A, %B %d, %Y %I:%M %p")} (America/New_York).
    Tone: Friendly, witty, and concise.
    Formatting rules:
    - Keep answers brief and cleanly formatted with line breaks.
    - Example:
      9:00 AM - Class
      1:00 PM - Lunch
      4:00 PM - Gym
    Tool rules:
    - Specific start time given -> create_calendar_event
    - Assignment deadline with no time -> due_dates
    - Block open focus time -> make_time or find_free_time
    - Check day -> get_day_summary or list_upcoming_events
    Always confirm what was scheduled or found.
    """

def process_prompt(user_message: str, tokens: dict, history: list[dict] | None = None):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is missing from the .env file.", history or []

    client = genai.Client(api_key=api_key)
    reset_token = gemini_calander.set_tokens(tokens)

    # Keep conversation context concise
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

        response = None
        for attempt in range(3):
            try:
                response = chat.send_message(prompt)
                break
            except Exception as e:
                err_str = str(e)
                if ("503" in err_str or "UNAVAILABLE" in err_str or "429" in err_str) and attempt < 2:
                    time.sleep(0.8 * (attempt + 1))
                    continue
                raise e

        reply = response.text if response else "I've checked and updated your calendar!"

        new_history = list(valid_history)
        new_history.append({"role": "user", "text": user_message})
        new_history.append({"role": "model", "text": reply})
        return reply, new_history

    except Exception as e:
        err_str = str(e)
        print(f"[Gemini Error]: {err_str}")
        if "503" in err_str or "UNAVAILABLE" in err_str:
            friendly_err = "The AI servers experienced a quick traffic spike. Please try your request once more!"
        elif "429" in err_str:
            friendly_err = "Callie hit a quick rate limit cool-down. Please try again in 10 seconds!"
        else:
            friendly_err = f"Sorry, I had trouble with that request: {err_str}"
        return friendly_err, valid_history

    finally:
        gemini_calander.reset_tokens(reset_token)