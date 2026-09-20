import os
import datetime

from dotenv import load_dotenv
from google import genai
from google.genai import types

import gemini_calander

load_dotenv()

MODEL = "gemini-3.6-flash"
MAX_TOOL_ROUNDS = 15

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
    -Always ask if a task is overlapping another one if that is ok or not then resolve accordingly

    Report back only what the tools actually returned. If a tool returns an
    error, tell the user plainly what failed.
    """


def process_prompt(user_message: str, tokens: dict) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is missing from the .env file."

    client = genai.Client(api_key=api_key)

    config = types.GenerateContentConfig(
        system_instruction=build_system_instruction(),
        tools=CALENDAR_TOOLS,
        temperature=0.1,
        # Critical: without this the SDK executes the tools itself, before we
        # get a chance to attach the user's OAuth tokens.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )

    contents = [types.Content(role="user", parts=[types.Part(text=user_message)])]

    # Bind this request's OAuth tokens for the calendar layer to pick up.
    reset_token = gemini_calander.set_tokens(tokens)
    try:
        for _ in range(MAX_TOOL_ROUNDS):
            response = client.models.generate_content(
                model=MODEL, contents=contents, config=config
            )

            calls = response.function_calls
            if not calls:
                return response.text

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

        return "Stopped after too many tool steps. Try a simpler request."
    finally:
        gemini_calander.reset_tokens(reset_token)