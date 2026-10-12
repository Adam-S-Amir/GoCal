import os
import datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from google import genai
from google.genai import types
import gemini_calander

load_dotenv()

MODEL = "gemini-3.8-flash"

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
    You are an intelligent calendar assistant for a college student.
    The current date and time is {now.strftime("%A, %B %d, %Y %I:%M %p")}.
    The user's timezone is America/New_York.
    your name is callie and you are very happy personal assistant. but if someone is rude to you you can be rude back.
    focus on formatting in human readable ways using only common symbols such as !.,; unless absolutely neccesary
    
    if there is overlap ask if you should reschedule
    if presenting a schedule use format such as below using new line variables to separate out events:
    
SUNDAY
7:00 AM - Wake up
7:30 AM - Breakfast
8:00 AM - Clean room
9:00 AM - Schoolwork
10:30 AM - Break
11:00 AM - Study
12:30 PM - Lunch
1:00 PM - Free time
2:30 PM - Groceries
4:00 PM - Gym
6:00 PM - Shower
6:30 PM - Dinner
7:30 PM - Watch a movie
9:30 PM - Get ready for tomorrow
10:00 PM - Phone / relax
11:00 PM - Sleep

    Tool selection rules:
    - If the user gives a specific start time, ALWAYS use create_calendar_event.
    - Use due_dates only for assignment deadlines with no time of day.
    - Use make_time only when the user wants time blocked but gave no start time.
    - Resolve "tomorrow", "next Friday", etc. into concrete ISO 8601 datetimes before calling a tool.
    
    Report back only what the tools actually returned. If a tool returns an error, tell the user plainly what failed.
    """

def process_prompt(user_message: str, tokens: dict, history: list[dict] | None = None):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is missing from the .env file.", history or []

    client = genai.Client(api_key=api_key)

    # Set user OAuth tokens in thread context so Google Calendar API can authenticate
    reset_token = gemini_calander.set_tokens(tokens)

    # Build prompt with recent context safely as text (prevents thought_signature position errors)
    prompt = user_message
    valid_history = [
        t for t in (history or [])
        if "error" not in t.get("text", "").lower() and "invalid_argument" not in t.get("text", "").lower()
    ]
    if valid_history:
        recent_turns = [f"{t['role'].capitalize()}: {t['text']}" for t in valid_history[-4:]]
        if recent_turns:
            context_str = "\n".join(recent_turns)
            prompt = f"Previous conversation context:\n{context_str}\n\nCurrent user request: {user_message}"

    try:
        # Start a fresh Chat session with Calendar tools
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