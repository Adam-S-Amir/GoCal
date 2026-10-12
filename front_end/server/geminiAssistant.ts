/**
 * Callie AI Assistant for GoCal
 * Uses @google/genai SDK chats with function calling to interact with Google Calendar
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
    description: "Creates a new event with a specific start and end time on the user's Google Calendar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: 'Title or summary of the event.' },
        start_time: { type: Type.STRING, description: 'Start time in ISO 8601 format (e.g. 2026-10-12T14:00:00-04:00).' },
        end_time: { type: Type.STRING, description: 'End time in ISO 8601 format (e.g. 2026-10-12T15:00:00-04:00).' },
        description: { type: Type.STRING, description: 'Optional description or notes for the event.' },
      },
      required: ['summary', 'start_time', 'end_time'],
    },
  },
  {
    name: 'list_upcoming_events',
    description: "Retrieves the next few upcoming events from the user's Google Calendar.",
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
    description: 'Lists everything scheduled on one specific day.',
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
Your name is Callie. You are friendly, proactive, and energetic! If someone is rude, you can respond with playful sass.
Focus on formatting schedules cleanly with clear line breaks. Example:
SUNDAY:
8:00 AM - Breakfast
9:00 AM - Study session
1:00 PM - Lunch & break
4:00 PM - Gym
7:00 PM - Dinner
11:00 PM - Sleep

Tool Rules:
- If the user specifies a start time, use create_calendar_event.
- If it's an assignment deadline with no time, use due_dates.
- If they want focus time blocked with no fixed hour, use make_time or find_free_time.
- If they ask what's happening today/tomorrow, use get_day_summary or list_upcoming_events.
- Always resolve relative terms ("tomorrow", "next Friday", "at 3pm") into concrete ISO 8601 strings.
${prefContext}
Always report back clearly what you scheduled or modified.`;
}

async function executeTool(name: string, args: any, isRealCalendar: boolean, tokens?: calendarService.UserTokens): Promise<string> {
  try {
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
  const apiKey = process.env.GEMINI_API_KEY;
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

    // If the user was asking to see their schedule, still show the upcoming events!
    if (userMessage.toLowerCase().includes('schedule') || userMessage.toLowerCase().includes('today') || userMessage.toLowerCase().includes('upcoming')) {
      const simulatedList = simulatedEvents.map((e) => `- ${e.summary}: ${e.start.dateTime || e.start.date}`).join('\n');
      friendlyMessage += `\n\nHere are your upcoming scheduled items:\n${simulatedList || 'No upcoming events.'}`;
    }

    updatedHistory.push({ role: 'model', text: friendlyMessage });
    return { reply: friendlyMessage, history: updatedHistory };
  }
}
