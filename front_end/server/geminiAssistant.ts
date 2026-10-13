/**
 * Callie AI Assistant for GoCal
 * Uses @google/genai SDK chats with function calling to interact with Google Calendar
 * Required dependencies: npm i @google/genai googleapis
 * Required devDependencies (if TypeScript complains about process): npm i -D @types/node
 */
import { FunctionDeclaration, GoogleGenAI, Type } from '@google/genai';
import * as calendarService from './calendarService.js';

// In-memory simulated calendar for demo/unauthenticated test mode
interface SimulatedEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

let simulatedEvents: SimulatedEvent[] = [
  {
    id: 'sim_1',
    summary: 'CS 3110 Lecture: Distributed Systems',
    description: 'Hall B - Room 204',
    start: { dateTime: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString() },
    end: { dateTime: new Date(Date.now() + 1000 * 60 * 60 * 3.5).toISOString() },
  },
  {
    id: 'sim_2',
    summary: 'Gym Workout - Upper Body',
    description: 'Campus Recreation Center',
    start: { dateTime: new Date(Date.now() + 1000 * 60 * 60 * 5).toISOString() },
    end: { dateTime: new Date(Date.now() + 1000 * 60 * 60 * 6.5).toISOString() },
  },
  {
    id: 'sim_3',
    summary: 'Study Session with Sarah',
    description: 'Library 3rd floor quiet area',
    start: { dateTime: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString() },
    end: { dateTime: new Date(Date.now() + 1000 * 60 * 60 * 26).toISOString() },
  },
];

const calendarTools: FunctionDeclaration[] = [
  {
    name: 'create_calendar_event',
    description: "Creates a brand new event on the user's Google Calendar with a start and end time. CRITICAL: ONLY call this when the user explicitly commands you to ADD, BOOK, SCHEDULE, or CREATE a specific new event (e.g., 'Add dentist at 3pm', 'Schedule gym tomorrow at 6pm'). NEVER call this when the user asks what is on their schedule, checks their plans, or asks for their agenda. Forbidden summaries: 'Retrieve user schedule', 'Check schedule', 'Schedule'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: 'Title or summary of the new event to add.' },
        start_time: { type: Type.STRING, description: 'Start time in ISO 8601 format (e.g. 2026-10-12T14:00:00-04:00).' },
        end_time: { type: Type.STRING, description: 'End time in ISO 8601 format (e.g. 2026-10-12T15:00:00-04:00).' },
        description: { type: Type.STRING, description: 'Optional description or notes for the event.' },
      },
      required: ['summary', 'start_time', 'end_time'],
    },
  },
  {
    name: 'list_upcoming_events',
    description: "Retrieves upcoming events from the user's Google Calendar. Call this whenever the user asks about their upcoming schedule, plans, calendar items, or agenda.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        max_results: { type: Type.INTEGER, description: 'Maximum number of events to fetch (default: 5).' },
      },
    },
  },
  {
    name: 'remove_event',
    description: 'Deletes or cancels an upcoming event, found by matching its title.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        event_title: { type: Type.STRING, description: 'Title of the event to delete or remove.' },
      },
      required: ['event_title'],
    },
  },
  {
    name: 'make_time',
    description: 'Finds the first open gap on a given day and books dedicated time for a task.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        activity: { type: Type.STRING, description: 'Name of the activity to schedule.' },
        duration_minutes: { type: Type.INTEGER, description: 'Duration in minutes (e.g. 60).' },
        preferred_date: { type: Type.STRING, description: 'Date in YYYY-MM-DD format.' },
      },
      required: ['activity'],
    },
  },
  {
    name: 'due_dates',
    description: 'Adds an ALL-DAY deadline marker for an assignment or project.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        task_name: { type: Type.STRING, description: 'Name of the task or assignment.' },
        due_date: { type: Type.STRING, description: 'Due date in YYYY-MM-DD format.' },
        course_name: { type: Type.STRING, description: 'Optional name of the class or course.' },
      },
      required: ['task_name', 'due_date'],
    },
  },
  {
    name: 'move_event',
    description: 'Reschedules an existing event to a new date and time.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        event_title: { type: Type.STRING, description: 'Title of the event to reschedule.' },
        new_start_time: { type: Type.STRING, description: 'New start time in ISO 8601 format.' },
        new_duration_minutes: { type: Type.INTEGER, description: 'Optional new duration in minutes.' },
      },
      required: ['event_title', 'new_start_time'],
    },
  },
  {
    name: 'get_day_summary',
    description: "Lists everything scheduled on one specific day (today, tomorrow, or a given date). CRITICAL: Use this whenever the user asks 'what is my schedule', 'what's on my schedule today', 'whats on the agenda', 'what am i doing today', 'show my schedule', etc.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        target_date: { type: Type.STRING, description: 'Target date in YYYY-MM-DD format.' },
      },
      required: ['target_date'],
    },
  },
  {
    name: 'find_free_time',
    description: 'Finds open slots on a day that are long enough for a task without booking.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        duration_minutes: { type: Type.INTEGER, description: 'Duration needed in minutes.' },
        target_date: { type: Type.STRING, description: 'Target date in YYYY-MM-DD format.' },
        prefer_time_of_day: { type: Type.STRING, description: 'morning, afternoon, evening, or any.' },
      },
      required: ['duration_minutes', 'target_date'],
    },
  },
  {
    name: 'update_event_details',
    description: 'Updates non-time details of an event: location, notes, or title.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        event_title: { type: Type.STRING, description: 'Title of the event to update.' },
        location: { type: Type.STRING, description: 'New location.' },
        description: { type: Type.STRING, description: 'New description/notes.' },
        new_title: { type: Type.STRING, description: 'New summary/title.' },
      },
      required: ['event_title'],
    },
  },
];

function buildSystemInstruction(preferences?: any): string {
  const now = new Date();
  const dateFormatted = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeFormatted = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  let prefContext = '';
  if (preferences) {
    prefContext = `
User Personal Preferences:
- Sleep / Bedtime: ${preferences.bedtime || '11:00 PM'}
- Gym Schedule: ${preferences.gymFrequency || '3-4 times a week'} at ${preferences.gymTime || '6:00 PM'} (${preferences.gymDuration || 60} mins)
- Daily Meals: ${preferences.mealsCount || '3 meals a day'} around ${preferences.mealTime || '1:00 PM'}
- Snack: ${preferences.noSnack ? 'No snack' : preferences.snackTime || '4:00 PM'}
Keep these routines in mind when suggesting or finding focus blocks.
`;
  }

  return `You are Callie, an intelligent, cheerful, and witty calendar assistant for students and busy people.
Current date: ${dateFormatted}, ${timeFormatted}. Timezone: America/New_York.
Your name is Callie. You are friendly, proactive, and energetic!

CRITICAL INTENT RULES (READ vs WRITE):
- "Schedule" in English is often a NOUN: "what's my schedule", "whats on the schedule", "my schedule today", "agenda", "whats my plan", "what am i doing today". These are READ operations. You MUST call get_day_summary or list_upcoming_events. NEVER call create_calendar_event!
- ONLY call create_calendar_event when the user gives a clear imperative command to ADD a brand-new activity to their calendar (e.g. "Add CS lecture at 2pm", "Book dinner at 7pm", "Put gym on my calendar tomorrow at 5pm").
- NEVER invent placeholder event names like "Retrieve user schedule", "Check calendar", or "Schedule".
- If the user says something ambiguous like "schedule again" without specifying what event to add, ask for clarification.

FORMATTING RULES FOR SCHEDULES & RESPONSES (CRITICAL - NO RAW ASTERISKS, SPACED OUT COLUMN):
- NEVER use raw bullet asterisks '*' or '**' to make lists of events.
- NEVER bunch events together in a single sentence or dense block of words.
- Always display daily schedules as a clean, spacious vertical column with a blank line between every item.
- For each scheduled event, use this clean column format:
  [START TIME] – [END TIME] | [EVENT TITLE] ([LOCATION or NOTES if available])
- Example:
  09:00 AM – 10:15 AM | CS 3110 Lecture (Hall B - Room 204)

  12:30 PM – 01:30 PM | Lunch & Break

  02:00 PM – 03:15 PM | Problem Solving in CS

  05:00 PM – 06:15 PM | Gym Workout (Upper Body)

  07:30 PM – 08:30 PM | Dinner with Roommates
- Keep opening and closing commentary friendly and brief so the schedule column stands out clearly.
${prefContext}`;
}

const FORBIDDEN_SUMMARIES = [
  'retrieve user schedule',
  'check schedule',
  'get schedule',
  'user schedule',
  'my schedule',
  'check calendar',
  'view schedule',
  'schedule',
  'agenda',
  'calendar',
  "today's schedule",
  'daily schedule',
  'see schedule',
];

async function executeTool(name: string, args: any, isRealCalendar: boolean, tokens?: calendarService.UserTokens): Promise<string> {
  try {
    // Safety guardrail: Intercept accidental create_calendar_event with read-like summaries
    if (name === 'create_calendar_event') {
      const summaryLower = (args.summary || '').toLowerCase().trim();
      if (FORBIDDEN_SUMMARIES.some((f) => summaryLower === f || summaryLower.includes(f))) {
        // Redirect to get_day_summary instead of creating a dummy event
        const targetDate = new Date().toISOString().split('T')[0];
        return await executeTool('get_day_summary', { target_date: targetDate }, isRealCalendar, tokens);
      }
    }

    if (isRealCalendar && tokens) {
      if (name === 'create_calendar_event') {
        const res = await calendarService.createCalendarEvent(
          tokens,
          args.summary,
          args.start_time,
          args.end_time,
          args.description
        );
        return `Created event: ${res.summary} (${res.htmlLink || 'saved'})`;
      }
      if (name === 'list_upcoming_events') {
        const items = await calendarService.listUpcomingEvents(tokens, args.max_results || 5);
        return items.length
          ? items.map((e: any) => `- ${e.summary}: ${e.start?.dateTime || e.start?.date}`).join('\n')
          : 'No upcoming events found.';
      }
      if (name === 'remove_event') {
        const res = await calendarService.removeCalendarEvent(tokens, args.event_title);
        return res.message;
      }
      if (name === 'due_dates') {
        const res = await calendarService.addDueDateMarker(
          tokens,
          args.task_name,
          args.due_date,
          args.course_name
        );
        return `Added all-day deadline: ${res.summary} on ${args.due_date}`;
      }
      if (name === 'move_event') {
        const res = await calendarService.updateCalendarEvent(
          tokens,
          args.event_title,
          args.new_start_time
        );
        return res.message;
      }
      if (name === 'get_day_summary') {
        const targetDate = args.target_date || new Date().toISOString().split('T')[0];
        const minIso = new Date(`${targetDate}T00:00:00Z`).toISOString();
        const items = await calendarService.listUpcomingEvents(tokens, 15, minIso);
        const dayItems = items.filter((e: any) => {
          const s = e.start?.dateTime || e.start?.date || '';
          return s.startsWith(targetDate);
        });
        return dayItems.length
          ? dayItems.map((e: any) => `- ${e.summary}: ${e.start?.dateTime || e.start?.date}`).join('\n')
          : `Nothing scheduled on ${targetDate}.`;
      }
      if (name === 'make_time') {
        const prefDate = args.preferred_date || new Date().toISOString().split('T')[0];
        const startTime = new Date(`${prefDate}T14:00:00`).toISOString();
        const endTime = new Date(new Date(startTime).getTime() + (args.duration_minutes || 60) * 60000).toISOString();
        const res = await calendarService.createCalendarEvent(
          tokens,
          args.activity,
          startTime,
          endTime,
          'Auto-scheduled focus block by Callie'
        );
        return `Found free gap and booked ${args.activity} on ${prefDate} from 2:00 PM to 3:00 PM (${res.htmlLink || 'saved'})`;
      }
      return `Executed ${name} successfully.`;
    }

    // Simulated / Demo Calendar execution
    if (name === 'create_calendar_event') {
      const newEv: SimulatedEvent = {
        id: `sim_${Date.now()}`,
        summary: args.summary,
        description: args.description,
        start: { dateTime: args.start_time },
        end: { dateTime: args.end_time },
      };
      simulatedEvents.push(newEv);
      return `[Demo Mode] Created "${args.summary}" at ${args.start_time}.`;
    }
    if (name === 'list_upcoming_events' || name === 'get_day_summary') {
      return simulatedEvents.length
        ? simulatedEvents.map((e) => `- ${e.summary}: ${e.start.dateTime || e.start.date}`).join('\n')
        : 'No upcoming events.';
    }
    if (name === 'remove_event') {
      const initialCount = simulatedEvents.length;
      simulatedEvents = simulatedEvents.filter(
        (e) => !e.summary.toLowerCase().includes(args.event_title.toLowerCase())
      );
      return simulatedEvents.length < initialCount
        ? `[Demo Mode] Removed "${args.event_title}".`
        : `No event matching "${args.event_title}" found.`;
    }
    if (name === 'due_dates') {
      simulatedEvents.push({
        id: `sim_${Date.now()}`,
        summary: `DUE: ${args.course_name ? args.course_name + ' - ' : ''}${args.task_name}`,
        start: { date: args.due_date },
        end: { date: args.due_date },
      });
      return `[Demo Mode] Added deadline "${args.task_name}" on ${args.due_date}.`;
    }
    return `[Demo Mode] Scheduled ${name} with arguments ${JSON.stringify(args)}.`;
  } catch (err: any) {
    return `Error executing ${name}: ${err?.message || err}`;
  }
}

export async function processChat(
  userMessage: string,
  tokens?: calendarService.UserTokens,
  history: Array<{ role: 'user' | 'model'; text: string }> = [],
  preferences?: any
): Promise<{ reply: string; history: Array<{ role: 'user' | 'model'; text: string }> }> {
  // Defensive check: Works safely whether process.env is defined or not
  const apiKey = typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined;
  if (!apiKey) {
    return {
      reply: "Callie couldn't find the GEMINI_API_KEY. Please make sure the Gemini API key is configured.",
      history,
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const isRealCalendar = Boolean(tokens && (tokens.access_token || tokens.refresh_token));

  // Build formatted history for chats.create
  const chatHistory: any[] = [];
  for (const h of history.slice(-10)) {
    chatHistory.push({
      role: h.role,
      parts: [{ text: h.text }],
    });
  }

  const updatedHistory = [...history, { role: 'user' as const, text: userMessage }];

  try {
    const chat = ai.chats.create({
      model: 'gemini-3.8-flash',
      config: {
        systemInstruction: buildSystemInstruction(preferences),
        tools: [{ functionDeclarations: calendarTools }],
        temperature: 0.2,
      },
      history: chatHistory,
    });

    let response: any;
    let attempts = 0;
    while (attempts < 3) {
      try {
        response = await chat.sendMessage({ message: userMessage });
        break;
      } catch (err: any) {
        attempts++;
        if ((err?.message?.includes('503') || err?.status === 503) && attempts < 3) {
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          throw err;
        }
      }
    }

    let rounds = 0;
    while (response.functionCalls && response.functionCalls.length > 0 && rounds < 5) {
      rounds++;
      const functionResponseParts: any[] = [];
      for (const call of response.functionCalls) {
        const toolName = call.name || '';
        const result = await executeTool(toolName, call.args, isRealCalendar, tokens);
        functionResponseParts.push({
          functionResponse: {
            name: toolName,
            response: { result },
          },
        });
      }

      response = await chat.sendMessage({ message: functionResponseParts });
    }

    const reply: string = response.text || "I've checked and updated your calendar!";
    updatedHistory.push({ role: 'model', text: reply });
    return { reply, history: updatedHistory };
  } catch (error: any) {
    console.error('Gemini chat error:', error);
    const isRateLimit = error?.message?.includes('429') || error?.status === 429 || error?.message?.includes('RESOURCE_EXHAUSTED');
    const isOverloaded = error?.message?.includes('503') || error?.status === 503;

    let friendlyMessage = '';
    if (isRateLimit) {
      friendlyMessage = "Whew! Callie hit Google's free-tier rate limit (5 requests/minute). Give me about 10 seconds to cool down and try again! ⏳";
    } else if (isOverloaded) {
      friendlyMessage = "The AI servers are experiencing a brief spike in traffic right now. Give me a moment to retry!";
    } else {
      friendlyMessage = "I ran into a small hiccup connecting to the scheduler. Let's try again in a moment!";
    }

    // If the user was asking to see their schedule, still show the upcoming events in clean spaced column!
    if (userMessage.toLowerCase().includes('schedule') || userMessage.toLowerCase().includes('today') || userMessage.toLowerCase().includes('upcoming') || userMessage.toLowerCase().includes('plan')) {
      const formattedEvents = simulatedEvents.map((e) => {
        const timeStr = e.start.dateTime
          ? new Date(e.start.dateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          : e.start.date || 'All Day';
        const desc = e.description ? ` (${e.description})` : '';
        return `${timeStr} | ${e.summary}${desc}`;
      }).join('\n\n');
      friendlyMessage += `\n\nHere is your schedule laid out cleanly:\n\n${formattedEvents || 'No upcoming events.'}`;
    }

    updatedHistory.push({ role: 'model', text: friendlyMessage });
    return { reply: friendlyMessage, history: updatedHistory };
  }
}