import os
import datetime

from dotenv import load_dotenv
from google import genai
from google.genai import types

import gemini_calander

load_dotenv()

MODEL = "gemini-3.6-flash"
MAX_TOOL_ROUNDS = 5

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
    now = datetime.datetime.now()
    return f"""
    You are an intelligent calendar assistant for a college student.
    The current date and time is {now.strftime("%A, %B %d, %Y %I:%M %p")}.
    The user's timezone is America/New_York.

    Tool selection rules:
    - If the user gives a specific start time, ALWAYS use create_calendar_event.
      Never use due_dates for something that happens at a known time.
    - Use due_dates only for assignment deadlines with no time of day.
    - Use make_time only when the user wants time blocked but gave no start time.
    - Resolve "tomorrow", "next Friday", etc. into concrete ISO 8601 datetimes
      before calling a tool.

    Conflict resolution rules:
    - Fixed events (classes, exams, work) cannot be moved.
    - Soft events (study, gym, personal) can be moved.
    - If a priority task conflicts with a soft event, call list_upcoming_events,
      then move_event to shift the flexible item, then schedule the new one.

    Report back only what the tools actually returned. If a tool returns an
    error, tell the user plainly what failed.
    """


MAX_HISTORY_TURNS = 20  # user+model pairs kept; older ones are dropped


def _history_to_contents(history: list[dict] | None) -> list[types.Content]:
    """Turn the plain-dict history we store in the Flask session back into
    Content objects. Only plain text turns are kept here — tool call/response
    parts are never persisted, so this stays JSON-serializable in the session."""
    contents = []
    for turn in (history or [])[-MAX_HISTORY_TURNS * 2:]:
        contents.append(types.Content(role=turn["role"], parts=[types.Part(text=turn["text"])]))
    return contents


def process_prompt(user_message: str, tokens: dict, history: list[dict] | None = None):
    """
    Returns (reply_text, updated_history).
    `history` is a JSON-serializable list of {"role": "user"|"model", "text": str},
    meant to be round-tripped through something like the Flask session.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is missing from the .env file.", history or []

    client = genai.Client(api_key=api_key)

    config = types.GenerateContentConfig(
        system_instruction=build_system_instruction(),
        tools=CALENDAR_TOOLS,
        temperature=0.1,
        # Critical: without this the SDK executes the tools itself, before we
        # get a chance to attach the user's OAuth tokens.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )

    # Prior turns + the new message. Tool call/response parts get appended
    # below for this request only — they are never written back to `history`.
    contents = _history_to_contents(history)
    contents.append(types.Content(role="user", parts=[types.Part(text=user_message)]))

    new_history = list(history or [])
    new_history.append({"role": "user", "text": user_message})

    # Bind this request's OAuth tokens for the calendar layer to pick up.
    reset_token = gemini_calander.set_tokens(tokens)
    try:
        for _ in range(MAX_TOOL_ROUNDS):
            response = client.models.generate_content(
                model=MODEL, contents=contents, config=config
            )

            calls = response.function_calls
            if not calls:
                new_history.append({"role": "model", "text": response.text})
                return response.text, new_history

            contents.append(response.candidates[0].content)

            tool_parts = []
            for call in calls:
                func = getattr(gemini_calander, call.name, None)
                if func is None:
                    result = f"Error: no tool named '{call.name}'."
                else:
                    try:
                        result = func(**(call.args or {}))
                    except Exception as e:
                        result = f"Error executing {call.name}: {e}"

                print(f"[tool] {call.name}({dict(call.args or {})}) -> {result}")
                tool_parts.append(
                    types.Part.from_function_response(
                        name=call.name, response={"result": result}
                    )
                )

            contents.append(types.Content(role="user", parts=tool_parts))

        reply = "Stopped after too many tool steps. Try a simpler request."
        new_history.append({"role": "model", "text": reply})
        return reply, new_history
    finally:
        gemini_calander.reset_tokens(reset_token)