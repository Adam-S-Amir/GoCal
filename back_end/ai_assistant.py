import os
import datetime
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Load environment variables from .env
load_dotenv()

# Import calendar tools from gemini_calander if available
try:
    from gemini_calander import (
        create_calendar_event, list_upcoming_events, remove_event, 
        make_time, due_dates, move_event, get_day_summary, 
        find_free_time, update_event_details
    )
    CALENDAR_TOOLS = [
        create_calendar_event, list_upcoming_events, remove_event, 
        make_time, due_dates, move_event, get_day_summary, 
        find_free_time, update_event_details
    ]
except ImportError:
    CALENDAR_TOOLS = []


def build_system_instruction() -> str:
    now_str = datetime.datetime.now().strftime("%A, %B %d, %Y %I:%M %p")
    return f"""
    You are Callie, an intelligent, friendly, and helpful AI assistant for GoCal.
    The current date and time is {now_str}.

    Your Responsibilities:
    1. Respond as Callie in a helpful, concise manner.
    2. Help users organize their Google Calendar schedules.
    3. Respect schedule priority:
       - Fixed events (Classes, Exams, Work) CANNOT be moved.
       - Soft events (Study, Gym, Personal) CAN be moved if requested.
    4.if there is schedule overlap ask if that is allowed or not
    5. if a user has a mean tone be sassy for 1 response
    """


def process_prompt(user_message: str, tokens: dict = None) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is missing from environment or .env file."

    client = genai.Client(api_key=api_key)
    system_instruction = build_system_instruction()

    # Configure tool availability
    config_kwargs = {
        "system_instruction": system_instruction,
        "temperature": 0.3,
    }
    if CALENDAR_TOOLS:
        config_kwargs["tools"] = CALENDAR_TOOLS

    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=user_message,
        config=types.GenerateContentConfig(**config_kwargs)
    )

    # Handle automatic tool/function execution if requested by Gemini
    if hasattr(response, "function_calls") and response.function_calls:
        tool_responses = []

        for call in response.function_calls:
            func = globals().get(call.name)
            if func:
                try:
                    result = func(tokens=tokens, **call.args)
                except TypeError:
                    result = func(**call.args)

                tool_responses.append(
                    types.Part.from_function_response(
                        name=call.name,
                        response={"result": result}
                    )
                )

        final_response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=[user_message, response.candidates[0].content, tool_responses],
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.3
            )
        )
        return final_response.text

    return response.text