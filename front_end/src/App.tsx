/**
 * GoCal - Intelligent AI Scheduling Companion with Callie
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  Calendar,
  Clock,
  Sparkles,
  Send,
  Mic,
  MicOff,
  ChevronRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  LogOut,
  Sliders,
  Info,
  CalendarDays,
  FileCode,
  Copy,
  Check,
  X,
} from 'lucide-react';

interface Message {
  sender: 'ai' | 'user';
  text: string;
  timestamp?: string;
  isAction?: boolean;
}

interface AuthStatus {
  authenticated: boolean;
  user: {
    id?: string;
    email?: string;
    name?: string;
    picture?: string;
  } | null;
  clientIdConfigured?: boolean;
  clientSecretConfigured?: boolean;
  configuredRedirectUri?: string;
  detectedRedirectUri?: string;
}

interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/**
 * Renders messages without raw markdown asterisks,
 * automatically formats schedules into clean, spaced-out columns with time badges,
 * and ensures responses are never a cramped block of words.
 */
function FormattedMessage({ text, isAi }: { text: string; isAi: boolean }) {
  if (!isAi) {
    return <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{text}</p>;
  }

  // Pre-process: split lines if schedule items were clumped on a single line with " * " or bullets
  let processed = text;
  // If multiple items are joined by " * **" or " * [time]", break them onto separate lines with blank line
  processed = processed.replace(/([^\n])\s*\*\s+(?=\*?\*?\d{1,2}:\d{2})/gi, '$1\n\n');
  processed = processed.replace(/([^\n])\s*\*\s+\*\*([^*]+)\*\*/g, '$1\n\n**$2**');

  const rawLines = processed.split('\n');

  // Helper to parse inline markdown bold (**bold**) and strip leftover stray asterisks
  const renderInline = (str: string) => {
    const parts = str.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((part, idx) => {
      if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('*') && part.endsWith('*'))) {
        const clean = part.replace(/^\*+|\*+$/g, '').trim();
        return <strong key={idx} className="font-bold text-[#1d3557]">{clean}</strong>;
      }
      const cleaned = part.replace(/\*/g, '');
      return <span key={idx}>{cleaned}</span>;
    });
  };

  interface ScheduleItem {
    time: string;
    title: string;
    details?: string;
  }

  interface Block {
    type: 'schedule' | 'bullet_list' | 'paragraph';
    items?: ScheduleItem[];
    bullets?: string[];
    text?: string;
  }

  const blocks: Block[] = [];
  let currentSchedule: ScheduleItem[] = [];
  let currentBullets: string[] = [];

  const flushSchedule = () => {
    if (currentSchedule.length > 0) {
      blocks.push({ type: 'schedule', items: [...currentSchedule] });
      currentSchedule = [];
    }
  };

  const flushBullets = () => {
    if (currentBullets.length > 0) {
      blocks.push({ type: 'bullet_list', bullets: [...currentBullets] });
      currentBullets = [];
    }
  };

  // Matches lines starting with time patterns, e.g.:
  // - 03:00 PM – 04:30 PM | Intro to Psychology Lecture (PSH 101)
  // - * **03:00 PM:** Intro to Psychology Lecture
  // - 8:00 AM - Breakfast
  // - **04:30 AM – 05:30 AM** | Wake up and eat
  const scheduleLineRegex = /^[\s*\-•]*\*?\*?(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?(?:\s*(?:–|-|—|to)\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)?)\*?\*?\s*([|:–—\-])\s*(.+)$/i;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i].trim();
    if (!rawLine) {
      flushSchedule();
      flushBullets();
      continue;
    }

    const schedMatch = rawLine.match(scheduleLineRegex);
    if (schedMatch) {
      flushBullets();
      const timeStr = schedMatch[1].trim();
      const rest = schedMatch[3].trim().replace(/^\*+|\*+$/g, '');

      let title = rest;
      let details: string | undefined = undefined;

      const parenMatch = rest.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (parenMatch) {
        title = parenMatch[1].trim();
        details = parenMatch[2].trim();
      } else if (rest.includes(' - ')) {
        const parts = rest.split(' - ');
        title = parts[0].trim();
        details = parts.slice(1).join(' - ').trim();
      }

      currentSchedule.push({
        time: timeStr,
        title: title.replace(/\*+/g, '').trim(),
        details: details ? details.replace(/\*+/g, '').trim() : undefined,
      });
      continue;
    }

    // Regular bullet point
    const bulletMatch = rawLine.match(/^[\s*\-•]\s*(.+)$/);
    if (bulletMatch && !rawLine.startsWith('**')) {
      flushSchedule();
      currentBullets.push(bulletMatch[1].trim());
      continue;
    }

    // Normal text paragraph
    flushSchedule();
    flushBullets();
    blocks.push({ type: 'paragraph', text: rawLine });
  }

  flushSchedule();
  flushBullets();

  return (
    <div className="flex flex-col gap-2.5 w-full">
      {blocks.map((block, idx) => {
        if (block.type === 'schedule' && block.items) {
          return (
            <div key={idx} className="my-2.5 flex flex-col gap-2.5 w-full">
              {block.items.map((item, sIdx) => (
                <div
                  key={sIdx}
                  className="flex items-start gap-3 p-3.5 rounded-xl bg-white/95 border border-emerald-300/80 shadow-xs hover:shadow-sm hover:border-emerald-400 transition-all"
                >
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-900 font-bold text-xs tracking-wide shrink-0">
                    <Clock className="w-3.5 h-3.5 text-emerald-700" />
                    <span>{item.time}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[#1d3557] text-[15px] leading-snug">
                      {item.title}
                    </div>
                    {item.details && (
                      <div className="text-xs text-gray-500 font-medium mt-1">
                        {item.details}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        }

        if (block.type === 'bullet_list' && block.bullets) {
          return (
            <ul key={idx} className="my-1.5 space-y-2 pl-1 w-full">
              {block.bullets.map((bText, bIdx) => (
                <li key={bIdx} className="flex items-start gap-2.5 text-[14.5px] text-[#1d3557]">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 mt-2 shrink-0" />
                  <span className="flex-1 leading-relaxed">{renderInline(bText)}</span>
                </li>
              ))}
            </ul>
          );
        }

        // Paragraph
        return (
          <p key={idx} className="text-[15px] leading-relaxed text-[#1d3557]">
            {renderInline(block.text || '')}
          </p>
        );
      })}
    </div>
  );
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'home' | 'chat' | 'privacy' | 'terms'>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase();
      if (path.includes('privacy')) return 'privacy';
      if (path.includes('terms')) return 'terms';
    }
    return 'home';
  });
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'ai',
      text: "Hi there! I'm Callie, your intelligent scheduling companion. How can I help you organize your day?",
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSnackDisabled, setIsSnackDisabled] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ authenticated: false, user: null });
  const [authNotification, setAuthNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showEventsDrawer, setShowEventsDrawer] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [copiedTab, setCopiedTab] = useState<string | null>(null);
  const [activeCodeTab, setActiveCodeTab] = useState<'app' | 'google' | 'requirements' | 'ai_assistant'>('app');
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  // Preferences form state
  const [preferences, setPreferences] = useState({
    bedtime: '23:00',
    gymFrequency: '3-4 times a week',
    gymTime: '18:00',
    gymDuration: 60,
    mealsCount: '3 meals a day',
    mealTime: '13:00',
    mealDuration: 30,
    snackTime: '16:00',
    noSnack: false,
  });

  const preferencesRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const speechRecognitionRef = useRef<any>(null);

  // Scroll to preferences
  const scrollToPreferences = () => {
    preferencesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Check URL query parameters for auth response
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authParam = urlParams.get('auth');
    const msg = urlParams.get('message') || urlParams.get('error_details');

    if (authParam === 'success') {
      setAuthNotification({
        type: 'success',
        message: 'Google Calendar successfully connected! Callie is now synced with your calendar.',
      });
      // Clean URL without reload
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (authParam === 'error') {
      setAuthNotification({
        type: 'error',
        message: msg ? `Authentication error: ${decodeURIComponent(msg)}` : 'Google sign-in could not be completed.',
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    fetchAuthStatus();

    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      if (path.includes('privacy')) setCurrentScreen('privacy');
      else if (path.includes('terms')) setCurrentScreen('terms');
      else setCurrentScreen('home');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (screen: 'home' | 'chat' | 'privacy' | 'terms') => {
    if (screen === 'home') {
      window.history.pushState({}, '', '/');
    } else if (screen === 'privacy') {
      window.history.pushState({}, '', '/privacy');
    } else if (screen === 'terms') {
      window.history.pushState({}, '', '/terms');
    }
    setCurrentScreen(screen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Fetch current auth status
  const fetchAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data: AuthStatus = await res.json();
        setAuthStatus(data);
      }
    } catch (e) {
      console.error('Failed to fetch auth status', e);
    }
  };

  // Fetch calendar events
  const fetchEvents = async () => {
    setLoadingEvents(true);
    try {
      const res = await fetch('/api/events');
      if (res.ok) {
        const data = await res.json();
        setCalendarEvents(data);
      } else {
        // Fallback demo events if not logged in
        setCalendarEvents([
          {
            summary: 'CS 3110 Lecture: Distributed Systems',
            start: { dateTime: new Date(Date.now() + 7200000).toISOString() },
            end: { dateTime: new Date(Date.now() + 12600000).toISOString() },
            description: 'Hall B - Room 204',
          },
          {
            summary: 'Gym Workout - Upper Body',
            start: { dateTime: new Date(Date.now() + 18000000).toISOString() },
            end: { dateTime: new Date(Date.now() + 23400000).toISOString() },
            description: 'Campus Recreation Center',
          },
        ]);
      }
    } catch (e) {
      console.error('Failed to fetch events', e);
    } finally {
      setLoadingEvents(false);
    }
  };

  // Auto-scroll chat
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Handle Google Login initiation
  const handleGoogleLogin = async () => {
    try {
      const res = await fetch('/api/auth/url');
      if (res.ok) {
        const data = await res.json();
        if (data.authUrl) {
          // Open in current window or top frame
          window.location.href = data.authUrl;
          return;
        }
      }
      setAuthNotification({
        type: 'error',
        message: 'Could not generate Google OAuth URL. Check your environment variables.',
      });
    } catch (err: any) {
      setAuthNotification({
        type: 'error',
        message: `Error initiating Google login: ${err?.message}`,
      });
    }
  };

  // Enable Demo / Sandbox Login
  const handleDemoLogin = async () => {
    try {
      const res = await fetch('/api/auth/demo-login', { method: 'POST' });
      if (res.ok) {
        await fetchAuthStatus();
        setAuthNotification({
          type: 'info',
          message: 'Switched to Demo Sandbox Mode with mock Google Calendar data.',
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Logout
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      await fetchAuthStatus();
      setAuthNotification({
        type: 'info',
        message: 'Disconnected from Google Calendar.',
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Save preferences
  const handleSavePreferences = async () => {
    try {
      await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
    } catch (e) {
      console.error(e);
    }
    window.scrollTo(0, 0);
    setCurrentScreen('chat');
  };

  // Send message to Callie
  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputValue;
    if (!text.trim() || isLoading) return;

    const userMessage: Message = { sender: 'user', text };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await response.json();

      if (response.ok) {
        setMessages((prev) => [...prev, { sender: 'ai', text: data.reply }]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            sender: 'ai',
            text: data.error || "I ran into a hiccup with that request. Let's try again!",
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: "I couldn't reach the server right now. Please check the network connection.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendMessage();
    }
  };

  // Speech Recognition (Voice Input)
  const toggleVoiceInput = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    if (isListening) {
      speechRecognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputValue(transcript);
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error(err);
      setIsListening(false);
    }
  };

  const todayDateFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const copyToClipboard = (text: string, tab: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTab(tab);
    setTimeout(() => setCopiedTab(null), 2000);
  };

  // Fixed code snippets for Render modal
  const codeSnippets = {
    app: `import os
from flask import Flask, redirect, request, session, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.middleware.proxy_fix import ProxyFix
from google_service import get_oauth_flow
from gemini_calander import list_upcoming_events
from ai_assistant import process_prompt

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SESSION_SECRET", "super_secret_dev_key_change_in_production")

# Reverse proxy fix: Essential for Render HTTPS termination
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)

# Cookie configuration for cross-site Google OAuth
app.config.update(
    SESSION_COOKIE_SAMESITE="None",
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
)

default_origins = "https://gocal.us,http://localhost:3000,http://localhost:5173"
allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", default_origins).split(",")
    if origin.strip()
]
CORS(app, supports_credentials=True, origins=allowed_origins if allowed_origins else "*")

def get_effective_redirect_uri():
    configured = os.getenv("GOOGLE_REDIRECT_URI")
    if configured and configured.startswith("http"):
        return configured
    scheme = request.headers.get('X-Forwarded-Proto', request.scheme)
    return f"{scheme}://{request.host}/api/auth/callback"

def get_frontend_target():
    target = session.pop('redirect_to', None) or os.getenv("FRONTEND_URL", "https://gocal.us")
    if target and not (target.startswith("http://") or target.startswith("https://") or target.startswith("/")):
        target = f"https://{target}"
    return target

@app.route('/')
def home():
    if 'tokens' in session:
        return redirect(f"{get_frontend_target()}?auth=success")
    return redirect(get_frontend_target())

@app.route('/login')
def login():
    redirect_to = request.args.get('redirect_to')
    if redirect_to:
        session['redirect_to'] = redirect_to
    elif request.referrer and 'google.com' not in request.referrer:
        session['redirect_to'] = request.referrer

    flow = get_oauth_flow(redirect_uri=get_effective_redirect_uri())
    auth_url, state = flow.authorization_url(access_type='offline', prompt='consent', include_granted_scopes='true')
    session['state'] = state
    if flow.code_verifier:
        session['code_verifier'] = flow.code_verifier
    return redirect(auth_url)

@app.route('/api/auth/url')
def auth_url():
    redirect_uri = get_effective_redirect_uri()
    flow = get_oauth_flow(redirect_uri=redirect_uri)
    url, state = flow.authorization_url(access_type='offline', prompt='consent', include_granted_scopes='true')
    session['state'] = state
    if flow.code_verifier:
        session['code_verifier'] = flow.code_verifier
    return jsonify({'authUrl': url, 'redirectUri': redirect_uri})

@app.route('/api/auth/callback')
def callback():
    state = session.get('state')
    redirect_uri = get_effective_redirect_uri()
    auth_response_url = request.url
    if request.headers.get('X-Forwarded-Proto') == 'https' and auth_response_url.startswith('http://'):
        auth_response_url = auth_response_url.replace('http://', 'https://', 1)
        
    try:
        flow = get_oauth_flow(state=state, redirect_uri=redirect_uri)
        if session.get('code_verifier'):
            flow.code_verifier = session.get('code_verifier')
        flow.fetch_token(authorization_response=auth_response_url)
        
        creds = flow.credentials
        session['tokens'] = {
            'access_token': creds.token,
            'refresh_token': creds.refresh_token or session.get('tokens', {}).get('refresh_token'),
        }
        target_url = get_frontend_target()
        separator = "&" if "?" in target_url else "?"
        return redirect(f"{target_url}{separator}auth=success")
    except Exception as e:
        target_url = get_frontend_target()
        separator = "&" if "?" in target_url else "?"
        return redirect(f"{target_url}{separator}auth=error&error_details={str(e)}")

@app.errorhandler(404)
def handle_404(e):
    if 'gocal.us' in request.path:
        return redirect('https://gocal.us?auth=success')
    return jsonify({'error': 'Not found', 'path': request.path}), 404`,

    google: `import os
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid'
]

def get_oauth_flow(state=None, redirect_uri=None):
    effective_uri = redirect_uri or os.getenv("GOOGLE_REDIRECT_URI")
    client_config = {
        "web": {
            "client_id": os.getenv("GOOGLE_CLIENT_ID"),
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [effective_uri]
        }
    }
    return Flow.from_client_config(
        client_config, 
        scopes=SCOPES, 
        redirect_uri=effective_uri,
        state=state
    )

def get_calendar_service(tokens):
    creds = Credentials(
        token=tokens.get('access_token'),
        refresh_token=tokens.get('refresh_token'),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.getenv("GOOGLE_CLIENT_ID"),
        client_secret=os.getenv("GOOGLE_CLIENT_SECRET")
    )
    return build('calendar', 'v3', credentials=creds)`,

    requirements: `Flask==3.1.0
flask-cors==6.0.0
gunicorn==23.0.0
google-auth==2.38.0
google-auth-oauthlib==1.2.1
google-auth-httplib2==0.2.0
google-api-python-client==2.162.0
google-genai==0.8.0
python-dotenv==1.0.1
requests==2.32.3
requests-oauthlib==2.0.0
Werkzeug==3.1.3
pydantic==2.10.6`,

    ai_assistant: `import os
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

FORBIDDEN_SUMMARIES = {
    "retrieve user schedule",
    "check schedule",
    "get schedule",
    "user schedule",
    "my schedule",
    "check calendar",
    "view schedule",
    "schedule",
    "agenda",
    "calendar",
    "today's schedule",
    "daily schedule",
    "see schedule",
}

def build_system_instruction() -> str:
    now = datetime.datetime.now(ZoneInfo("America/New_York"))
    return f"""You are Callie, an energetic, cheerful, and witty calendar assistant for college students and busy people.
Current time: {now.strftime("%A, %B %d, %Y %I:%M %p")} (America/New_York).
Your name is Callie.
Tone: Friendly, encouraging, witty, and organized.

CRITICAL INTENT RULES (READ vs WRITE):
- The word "schedule" is very often a NOUN: "what's my schedule", "whats on the schedule", "my schedule today", "agenda", "what am i doing today". These are READ operations. NEVER create an event when someone asks about their schedule.
- ONLY create an event when the user explicitly commands you to ADD or BOOK a specific new activity (e.g. "Add CS lecture at 2pm", "Schedule gym tomorrow at 6pm").
- NEVER invent placeholder event names like "Retrieve user schedule", "Check calendar", or "Schedule".

FORMATTING RULES FOR SCHEDULES (SPACED VERTICAL COLUMN, NO RAW ASTERISKS):
- NEVER output a dense block or clump of text.
- NEVER use raw asterisks like '*' for list items.
- Always display daily schedules as a clean, spacious vertical column with a blank line between every item.
- For each scheduled event, use this clean column format:
  [START TIME] – [END TIME] | [EVENT TITLE] ([LOCATION or NOTES if available])
- Example layout:
  09:00 AM – 10:15 AM | CS 3110 Lecture (Hall B)

  12:30 PM – 01:30 PM | Lunch with Sarah (Campus Center)

  04:00 PM – 05:15 PM | Gym Workout (Upper Body)

  07:30 PM – 08:30 PM | Study Session (Library 3rd Floor)
- Keep opening and closing commentary friendly and brief so the schedule column stands out clearly.
"""

def safe_generate_content(client, prompt: str, fallback_text: str = "") -> str:
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
            break
    return fallback_text

def is_asking_for_schedule(msg_lower: str) -> bool:
    if "schedule" in msg_lower:
        if any(p in msg_lower for p in ["my schedule", "the schedule", "a schedule", "our schedule", "today's schedule"]):
            return True
        if any(ind in msg_lower for ind in ["what", "whats", "what's", "check", "show", "see", "view", "again"]):
            return True

    return any(p in msg_lower for p in [
        "whats on", "what's on", "whats my", "what's my", "what do i have",
        "what am i doing", "what am i up to", "my agenda", "upcoming events",
        "any plans", "check calendar", "view calendar", "today's plan"
    ])

def is_asking_to_create_event(msg_lower: str) -> bool:
    if is_asking_for_schedule(msg_lower):
        return False

    create_verbs = [
        "add ", "add an ", "add a ", "put ", "book ", "set an event",
        "set a meeting", "create an event", "create event", "schedule a ",
        "schedule an ", "schedule gym", "schedule meeting", "schedule lunch",
        "schedule dinner", "schedule workout", "schedule study", "schedule class",
        "remind me to", "put on my calendar", "add to my calendar"
    ]
    return any(cv in msg_lower for cv in create_verbs)

def process_prompt(user_message: str, tokens: dict, history: list[dict] | None = None):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is missing from the .env file.", history or []

    client = genai.Client(api_key=api_key)
    reset_token = gemini_calander.set_tokens(tokens)
    msg_lower = user_message.lower().strip()
    now = datetime.datetime.now(ZoneInfo("America/New_York"))

    is_delete_intent = any(w in msg_lower for w in ["remove", "delete", "cancel"]) and not is_asking_for_schedule(msg_lower)
    is_free_time_query = any(w in msg_lower for w in ["free time", "open slot", "free slot", "open time", "when am i free"])
    is_schedule_query = is_asking_for_schedule(msg_lower)
    is_create_intent = is_asking_to_create_event(msg_lower) and not is_schedule_query

    try:
        if is_free_time_query:
            target = "tomorrow" if "tomorrow" in msg_lower else "today"
            free_slots = gemini_calander.find_free_time(30, target, "any")
            prompt = f"""{build_system_instruction()}
User asked: "{user_message}".
Here is their real Google Calendar open slots data:
{free_slots}

Respond cheerfully in character as Callie and list their free slots vertically with clear spacing:"""
            fallback = f"Here is what I found for your open slots:\\n\\n{free_slots}"
            reply = safe_generate_content(client, prompt, fallback_text=fallback)

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
                    events = f"Nothing scheduled for today.\\nUpcoming items:\\n{upcoming}"

            prompt = f"""{build_system_instruction()}
User asked: "{user_message}".
Here is their actual live Google Calendar data:
{events}

Respond in character as Callie. Lay out their schedule in a clean vertical column with an empty line between each event. Do not use raw asterisks:"""
            fallback = f"Here is what's on your schedule:\\n\\n{events}"
            reply = safe_generate_content(client, prompt, fallback_text=fallback)

        elif is_create_intent:
            extract_prompt = f"""Extract the event details from this user request.
Current time: {now.strftime("%A, %B %d, %Y %I:%M %p")} EDT.
User request: "{user_message}"
Output ONLY a raw JSON object with no markdown:
{{"summary": "Event Title", "start_time": "YYYY-MM-DDTHH:MM:SS-04:00", "end_time": "YYYY-MM-DDTHH:MM:SS-04:00"}}"""
            raw_text = safe_generate_content(client, extract_prompt, fallback_text="")
            if chr(96) * 3 in raw_text:
                raw_text = raw_text.replace(chr(96) * 3, "").replace("json", "").strip()

            try:
                event_data = json.loads(raw_text)
                summary = event_data.get("summary", "New Event").strip()

                if summary.lower() in FORBIDDEN_SUMMARIES or "schedule" in summary.lower():
                    events = gemini_calander.get_day_summary("today")
                    reply = f"Here is what is currently on your schedule:\\n\\n{events}"
                else:
                    start_time = event_data.get("start_time")
                    end_time = event_data.get("end_time")
                    if not end_time and start_time:
                        st = datetime.datetime.fromisoformat(start_time)
                        end_time = (st + datetime.timedelta(hours=1)).isoformat()

                    if start_time and end_time:
                        gemini_calander.create_calendar_event(summary, start_time, end_time, "Created by Callie")
                        st_formatted = datetime.datetime.fromisoformat(start_time).strftime("%I:%M %p")
                        reply = f"All set! I've added {summary} for {st_formatted} to your Google Calendar! 🗓️"
                    else:
                        reply = f"I'd love to schedule {summary} for you! What time and day would you like it booked?"
            except Exception:
                reply = "I'm ready to schedule that! Could you confirm the exact start time and day?"

        elif is_delete_intent:
            extract_prompt = f"""Extract the event title to remove from: "{user_message}".
Output ONLY raw JSON: {{"title": "Title to remove"}}"""
            raw_text = safe_generate_content(client, extract_prompt, fallback_text="")
            if chr(96) * 3 in raw_text:
                raw_text = raw_text.replace(chr(96) * 3, "").replace("json", "").strip()
            try:
                data = json.loads(raw_text)
                title = data.get("title", "")
                reply = gemini_calander.remove_event(title)
            except Exception:
                reply = "Which event title would you like me to remove from your calendar?"

        else:
            context = ""
            if history:
                recent = [f"{t['role'].capitalize()}: {t['text']}" for t in history[-3:] if "error" not in t.get("text", "").lower()]
                context = "Recent conversation:\\n" + "\\n".join(recent) + "\\n\\n"

            prompt = f"{build_system_instruction()}\\n\\n{context}User: {user_message}\\nCallie:"
            fallback = "Hi there! I'm Callie, your calendar assistant. How can I help you today?"
            reply = safe_generate_content(client, prompt, fallback_text=fallback)

        new_history = list(history or [])
        new_history.append({"role": "user", "text": user_message})
        new_history.append({"role": "model", "text": reply})
        return reply, new_history

    except Exception as e:
        print(f"[Callie Error]: {e}")
        try:
            events = gemini_calander.list_upcoming_events(5)
            return f"Here is what's coming up on your calendar:\\n\\n{events}", history or []
        except Exception:
            return "Hi! How can I help you organize your calendar today?", history or []
    finally:
        gemini_calander.reset_tokens(reset_token)`,
  };

  return (
    <>
      {/* Toast Notification */}
      {authNotification && (
        <div
          className={`fixed top-4 right-4 z-50 max-w-md p-4 rounded-xl shadow-lg border flex items-start gap-3 transition-all animate-bounce-short ${
            authNotification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : authNotification.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-sky-50 border-sky-200 text-sky-900'
          }`}
        >
          {authNotification.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : authNotification.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 text-sm font-medium">{authNotification.message}</div>
          <button
            onClick={() => setAuthNotification(null)}
            className="text-gray-400 hover:text-gray-600 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* HOME & PREFERENCES SCREEN */}
      {currentScreen === 'home' && (
        <div className="min-h-screen bg-[#f8fbfb]">
          {/* Hero Container */}
          <div className="hero-container">
            {/* Background elements with floating animation */}
            <div className="calendar-bg cal-1">
              <div className="cal-header"></div>
              <div className="cal-grid">
                <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
                <i></i><i className="active"></i><i></i><i></i><i></i><i></i><i></i>
                <i></i><i></i><i></i><i className="active"></i><i></i><i></i><i></i>
                <i></i><i></i><i></i><i></i><i></i><i className="active"></i><i></i>
                <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
              </div>
            </div>
            <div className="calendar-bg cal-2">
              <div className="cal-header" style={{ width: '70%' }}></div>
              <div className="cal-grid">
                <i></i><i></i><i className="active"></i><i></i><i></i><i></i><i></i>
                <i></i><i></i><i></i><i></i><i></i><i className="active"></i><i></i>
                <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
                <i></i><i className="active"></i><i></i><i></i><i></i><i></i><i></i>
                <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
              </div>
            </div>

            {/* Header Navigation */}
            <header className="header flex justify-between items-center w-full max-w-5xl pt-4 px-6 z-10">
              <div className="flex items-center gap-3">
                <img src="/GoCal-Logo.png" alt="GoCal Logo" className="h-10 w-auto object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <h1 className="logo text-3xl font-extrabold text-[#1d3557]">GoCal</h1>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigateTo('privacy')}
                  className="hidden md:inline-block text-xs font-semibold text-gray-500 hover:text-[#1d3557] transition"
                >
                  Privacy Policy
                </button>
                <button
                  type="button"
                  onClick={() => navigateTo('terms')}
                  className="hidden md:inline-block text-xs font-semibold text-gray-500 hover:text-[#1d3557] transition"
                >
                  Terms of Service
                </button>

                <button
                  type="button"
                  onClick={() => setShowDiagnostics(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition shadow-sm"
                >
                  <ShieldCheck className="w-4 h-4 text-amber-600" />
                  Render Auth Fix Guide
                </button>

                {authStatus.authenticated ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>{authStatus.user?.email || 'Calendar Synced'}</span>
                    <button
                      onClick={handleLogout}
                      title="Disconnect Google Calendar"
                      className="text-gray-400 hover:text-rose-600 ml-1"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleDemoLogin}
                    className="text-xs text-gray-500 hover:text-[#1d3557] font-medium underline underline-offset-4"
                  >
                    Quick Demo Sandbox
                  </button>
                )}
              </div>
            </header>

            {/* Hero Main Content */}
            <div className="hero-section mt-8">
              <h2 className="main-title text-6xl md:text-7xl font-black text-[#1d3557] tracking-tight">
                Welcome !
              </h2>
              <div className="about-section max-w-xl mx-auto">
                <h3 className="subtitle text-xl font-bold text-[#1d3557] mb-2">
                  What we do
                </h3>
                <p className="description text-gray-600 text-base leading-relaxed">
                  An intelligent AI scheduling companion that syncs natural language instructions
                  directly with your Google Calendar.
                </p>
              </div>

              {/* Action Buttons & Auth */}
              <div className="action-buttons flex flex-col items-center gap-4 mt-6">
                <button
                  type="button"
                  onClick={scrollToPreferences}
                  className="btn-primary flex items-center justify-center gap-2 group cursor-pointer"
                >
                  <span>Get Started</span>
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Google Sign In Card */}
                <div className="w-full max-w-sm mt-2 flex flex-col items-center gap-2">
                  <p className="login-hint text-xs text-gray-400 font-medium uppercase tracking-wider">
                    Google Calendar Integration
                  </p>

                  {authStatus.authenticated ? (
                    <div className="w-full bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold">
                          {authStatus.user?.picture ? (
                            <img src={authStatus.user.picture} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                          ) : (
                            authStatus.user?.name?.charAt(0) || 'G'
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-[#1d3557]">
                            {authStatus.user?.name || 'Google User'}
                          </div>
                          <div className="text-xs text-emerald-600 flex items-center gap-1 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Calendar Connected
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setCurrentScreen('chat')}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#b7e4c7] text-[#1d3557] hover:bg-[#a8dadc] transition"
                      >
                        Open Callie &rarr;
                      </button>
                    </div>
                  ) : (
                    <div className="w-full flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handleGoogleLogin}
                        className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-sm hover:shadow transition-all group"
                      >
                        {/* Google G SVG */}
                        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                          <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                          />
                        </svg>
                        <span>Connect Google Calendar</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleDemoLogin}
                        className="text-xs text-center text-gray-500 hover:text-emerald-700 py-1 transition"
                      >
                        ⚡ Or launch immediately in Instant Sandbox Mode
                      </button>

                      <div className="flex items-center justify-center gap-2 text-[11px] text-gray-400 mt-1">
                        <button
                          type="button"
                          onClick={() => navigateTo('privacy')}
                          className="hover:text-[#1d3557] underline cursor-pointer"
                        >
                          Privacy Policy
                        </button>
                        <span>•</span>
                        <button
                          type="button"
                          onClick={() => navigateTo('terms')}
                          className="hover:text-[#1d3557] underline cursor-pointer"
                        >
                          Terms of Service
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <p className="scroll-down-hint mb-4 cursor-pointer" onClick={scrollToPreferences}>
              Scroll down to explore features &amp; preferences &darr;
            </p>
          </div>

          {/* PUBLIC ABOUT GOCAL & GOOGLE CALENDAR PURPOSE SECTION (Google OAuth Compliance) */}
          <div className="w-full max-w-4xl mx-auto px-6 py-12 space-y-10">
            <div className="text-center max-w-2xl mx-auto space-y-3">
              <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800">
                Application Purpose &amp; Integration
              </span>
              <h2 className="text-3xl font-extrabold text-[#1d3557]">
                How GoCal Enhances Your Google Calendar
              </h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                GoCal is an artificial intelligence-assisted scheduling companion featuring Callie. We integrate directly with your Google Calendar through official Google OAuth 2.0 to make managing academic, personal, and social commitments effortless.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1d3557] flex items-center justify-center font-bold">
                  <CalendarDays className="w-5 h-5 text-[#457b9d]" />
                </div>
                <h3 className="font-bold text-base text-[#1d3557]">1. Real-Time Agenda Overview</h3>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Callie reads your Google Calendar events to display clean, vertically spaced daily and weekly overviews when you ask &quot;what&apos;s my schedule?&quot; without any cluttered text clumps.
                </p>
              </div>

              <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold">
                  <RefreshCw className="w-5 h-5 text-emerald-600" />
                </div>
                <h3 className="font-bold text-base text-[#1d3557]">2. Natural Rescheduling</h3>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Easily update appointments hands-free (e.g. &quot;move Spanish to 8pm&quot; or &quot;cancel gym&quot;). Callie locates the matching event, deletes the old slot, and inserts it at your new target time.
                </p>
              </div>

              <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-800 flex items-center justify-center font-bold">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                </div>
                <h3 className="font-bold text-base text-[#1d3557]">3. Smart Downtime Discovery</h3>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Ask Callie &quot;when this week is a good time to see my friends?&quot; and she analyzes the actual open gaps between your lectures and commitments to find optimal windows to relax.
                </p>
              </div>
            </div>

            {/* Privacy & Trust Assurance Box */}
            <div className="p-6 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1 max-w-xl">
                <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>Privacy-First &amp; Never Sold</span>
                </div>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  We strictly access your calendar to fulfill your direct conversational commands. We never sell, rent, or trade your Google data to third parties, and you can revoke access at any time in your Google Account settings.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => navigateTo('privacy')}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#1d3557] bg-white border border-emerald-300 hover:bg-emerald-50 transition shadow-2xs"
                >
                  Privacy Policy
                </button>
                <button
                  type="button"
                  onClick={() => navigateTo('terms')}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#1d3557] bg-white border border-emerald-300 hover:bg-emerald-50 transition shadow-2xs"
                >
                  Terms of Service
                </button>
              </div>
            </div>
          </div>

          {/* PREFERENCES SECTION */}
          <div ref={preferencesRef} className="preferences-section">
            <div className="g-form-card">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-2xl font-bold text-[#1d3557]">Welcome! (New User)</h2>
                <Sliders className="w-5 h-5 text-gray-400" />
              </div>
              <p>Please tell us your scheduling preferences so Callie can optimize your calendar.</p>

              <div className="form-group">
                <label>Sleep Schedule (Bedtime)</label>
                <input
                  type="time"
                  value={preferences.bedtime}
                  onChange={(e) => setPreferences({ ...preferences, bedtime: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Gym Schedule</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <select
                    value={preferences.gymFrequency}
                    onChange={(e) => setPreferences({ ...preferences, gymFrequency: e.target.value })}
                  >
                    <option>1-2 times a week</option>
                    <option>3-4 times a week</option>
                    <option>5-6 times a week</option>
                    <option>Everyday</option>
                  </select>
                  <input
                    type="time"
                    value={preferences.gymTime}
                    onChange={(e) => setPreferences({ ...preferences, gymTime: e.target.value })}
                  />
                  <input
                    type="number"
                    placeholder="Mins"
                    style={{ width: '100px' }}
                    value={preferences.gymDuration}
                    onChange={(e) => setPreferences({ ...preferences, gymDuration: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Daily Meals</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <select
                    value={preferences.mealsCount}
                    onChange={(e) => setPreferences({ ...preferences, mealsCount: e.target.value })}
                  >
                    <option>2 meals a day</option>
                    <option>3 meals a day</option>
                    <option>4 meals a day</option>
                    <option>5+ meals a day</option>
                  </select>
                  <input
                    type="time"
                    value={preferences.mealTime}
                    onChange={(e) => setPreferences({ ...preferences, mealTime: e.target.value })}
                  />
                  <input
                    type="number"
                    placeholder="Mins"
                    style={{ width: '100px' }}
                    value={preferences.mealDuration}
                    onChange={(e) => setPreferences({ ...preferences, mealDuration: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Typical Snack Time</label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input
                    type="time"
                    value={preferences.snackTime}
                    disabled={preferences.noSnack}
                    onChange={(e) => setPreferences({ ...preferences, snackTime: e.target.value })}
                  />
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontWeight: 'normal',
                      margin: '0',
                      cursor: 'pointer',
                      color: 'rgb(107, 114, 128)',
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: 'auto', margin: '0' }}
                      checked={preferences.noSnack}
                      onChange={(e) => {
                        setIsSnackDisabled(e.target.checked);
                        setPreferences({ ...preferences, noSnack: e.target.checked });
                      }}
                    />{' '}
                    No snack
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSavePreferences}
                className="btn-primary"
                style={{ fontSize: '16px', padding: '14px 25px', width: '100%', marginTop: '15px' }}
              >
                Save & Continue to Chat
              </button>
            </div>

            <div className="footer">
              <a href="#home" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                Home
              </a>
              <button
                onClick={() => navigateTo('privacy')}
                className="text-gray-400 hover:text-gray-600 text-sm bg-transparent border-0 cursor-pointer"
              >
                Privacy Policy
              </button>
              <button
                onClick={() => navigateTo('terms')}
                className="text-gray-400 hover:text-gray-600 text-sm bg-transparent border-0 cursor-pointer"
              >
                Terms of Service
              </button>
              <button
                onClick={() => setShowDiagnostics(true)}
                className="text-gray-400 hover:text-gray-600 text-sm bg-transparent border-0 cursor-pointer"
              >
                Render Fix Guide
              </button>
              <a href="https://github.com/Adam-S-Amir/GoCal" target="_blank" rel="noreferrer">
                GitHub Repository
              </a>
            </div>
          </div>
        </div>
      )}

      {/* DEDICATED FULL-PAGE PRIVACY POLICY SCREEN (for https://gocal.us/privacy) */}
      {currentScreen === 'privacy' && (
        <div className="min-h-screen bg-slate-50 py-10 px-4 flex justify-center">
          <div className="max-w-2xl w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-5">
              <div className="flex items-center gap-3">
                <img src="/GoCal-Logo.png" alt="Logo" className="w-9 h-9 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <span className="text-2xl font-black text-[#1d3557]">GoCal</span>
              </div>
              <button
                type="button"
                onClick={() => navigateTo('home')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-[#1d3557] bg-slate-100 hover:bg-slate-200 transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to GoCal</span>
              </button>
            </div>

            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1d3557] mb-1">Privacy Policy</h1>
              <p className="text-xs text-slate-400 font-medium">Last updated: October 13, 2026</p>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm leading-relaxed">
              <strong>Plain English Summary:</strong> GoCal and its AI scheduling companion Callie only access your Google Calendar to fulfill the direct scheduling requests you ask for (like checking your schedule, moving a class, or adding a study session). We never sell your data, never share it with advertisers, and you can revoke access at any time.
            </div>

            <div className="space-y-4 text-xs sm:text-sm text-slate-600 leading-relaxed">
              <div>
                <h2 className="text-base font-bold text-slate-900 mb-1">1. Overview</h2>
                <p>
                  GoCal is an intelligent calendar assistant powered by conversational AI. We respect your privacy and are committed to protecting any information processed while using our service.
                </p>
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900 mb-1">2. Google User Data We Access</h2>
                <p className="mb-2">
                  When you sign in using Google OAuth, GoCal requests access to the Google Calendar API (<code>https://www.googleapis.com/auth/calendar</code>). We access:
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-700 pl-2">
                  <li><strong>Calendar Events:</strong> Titles, dates, start/end times, and descriptions so Callie can read your daily schedule and find open gaps.</li>
                  <li><strong>Basic Profile Info:</strong> Your Google email and name to verify your user session.</li>
                </ul>
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900 mb-1">3. How Your Data Is Used</h2>
                <p>
                  Your calendar data is used strictly to fulfill direct scheduling features you request:
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-700 pl-2 mt-1">
                  <li>Displaying your upcoming schedule and agenda.</li>
                  <li>Adding, rescheduling, and removing events based on your natural language commands.</li>
                  <li>Analyzing open gaps between commitments to help you plan free time and socialize.</li>
                </ul>
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900 mb-1">4. Data Sharing & Security</h2>
                <p>
                  <strong>We do not sell, rent, or trade your Google Calendar data to any third parties.</strong> Authentication tokens are stored securely in encrypted HTTP-only session cookies and transmitted strictly over HTTPS. We do not use your private calendar events to train public models.
                </p>
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900 mb-1">5. Revoking Access</h2>
                <p>
                  You can disconnect GoCal at any time by signing out or by visiting your{' '}
                  <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-700 font-semibold underline inline-flex items-center gap-0.5"
                  >
                    Google Account Security &amp; Permissions <ExternalLink className="w-3 h-3" />
                  </a>.
                </p>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
              <span>&copy; 2026 GoCal. All rights reserved.</span>
              <button onClick={() => navigateTo('terms')} className="text-slate-600 hover:text-slate-900 underline">
                Terms of Service
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DEDICATED FULL-PAGE TERMS OF SERVICE SCREEN (for https://gocal.us/terms) */}
      {currentScreen === 'terms' && (
        <div className="min-h-screen bg-slate-50 py-10 px-4 flex justify-center">
          <div className="max-w-2xl w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-5">
              <div className="flex items-center gap-3">
                <img src="/GoCal-Logo.png" alt="Logo" className="w-9 h-9 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <span className="text-2xl font-black text-[#1d3557]">GoCal</span>
              </div>
              <button
                type="button"
                onClick={() => navigateTo('home')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-[#1d3557] bg-slate-100 hover:bg-slate-200 transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to GoCal</span>
              </button>
            </div>

            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1d3557] mb-1">Terms of Service</h1>
              <p className="text-xs text-slate-400 font-medium">Last updated: October 13, 2026</p>
            </div>

            <div className="space-y-4 text-xs sm:text-sm text-slate-600 leading-relaxed">
              <div>
                <h2 className="text-base font-bold text-slate-900 mb-1">1. Acceptance of Terms</h2>
                <p>
                  By accessing GoCal and using Callie (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree to these terms, please discontinue use.
                </p>
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900 mb-1">2. Description of Service</h2>
                <p>
                  GoCal provides conversational calendar assistance using artificial intelligence. The service connects with your Google Calendar account via standard Google OAuth 2.0 to manage events and schedules.
                </p>
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900 mb-1">3. User Responsibilities</h2>
                <p>
                  You are responsible for reviewing and confirming calendar events, appointments, and reschedules made through the application. While Callie strives for high precision, you are responsible for maintaining your commitments.
                </p>
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900 mb-1">4. AI &amp; Accuracy Disclaimers</h2>
                <p>
                  The service is provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis without warranties of any kind. The developers are not liable for missed meetings, scheduling conflicts, or external Google service disruptions.
                </p>
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900 mb-1">5. Termination</h2>
                <p>
                  You may stop using GoCal at any time by disconnecting your Google account or revoking permissions in your Google Account settings.
                </p>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
              <span>&copy; 2026 GoCal. All rights reserved.</span>
              <button onClick={() => navigateTo('privacy')} className="text-slate-600 hover:text-slate-900 underline">
                Privacy Policy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHAT SCREEN */}
      {currentScreen === 'chat' && (
        <div className="chat-layout">
          {/* Chat Sidebar */}
          <div className="chat-sidebar">
            <button
              type="button"
              onClick={() => setCurrentScreen('home')}
              className="btn-back flex items-center gap-1 hover:text-[#1d3557] transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>

            <div className="sidebar-logo flex items-center gap-2">
              <img src="/GoCal-Logo.png" alt="Logo" className="w-8 h-8 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <h1 className="logo text-2xl font-black text-[#1d3557]">GoCal</h1>
            </div>

            {/* Callie Mascot Avatar */}
            <div className="mascot-section">
              <div className={`mascot-circle ${isLoading ? 'speaking' : ''}`}>
                <span>Callie</span>
              </div>
              <p className="mascot-text">
                Keep Calm and ask Callie about your calendar
              </p>

              {/* Sync Status Badge */}
              <div className="w-full px-4 py-2 bg-white/70 border border-[#a8dadc] rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-gray-700">
                  <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{authStatus.authenticated ? 'Live Calendar' : 'Demo Calendar'}</span>
                </div>
                <button
                  onClick={() => {
                    fetchEvents();
                    setShowEventsDrawer(true);
                  }}
                  className="text-xs text-[#1d3557] font-semibold underline"
                >
                  View Events
                </button>
              </div>

              {/* Quick Prompts */}
              <div className="w-full flex flex-col gap-1.5 mt-2">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1">
                  Quick Actions
                </span>
                <button
                  onClick={() => handleSendMessage("What's on my schedule today?")}
                  className="text-left text-xs p-2 rounded-lg bg-white/80 hover:bg-white text-gray-700 border border-gray-100 transition shadow-2xs hover:border-[#a8dadc]"
                >
                  📅 What's on my schedule today?
                </button>
                <button
                  onClick={() => handleSendMessage('Schedule gym tomorrow at 6 PM')}
                  className="text-left text-xs p-2 rounded-lg bg-white/80 hover:bg-white text-gray-700 border border-gray-100 transition shadow-2xs hover:border-[#a8dadc]"
                >
                  🏃 Schedule gym tomorrow at 6 PM
                </button>
                <button
                  onClick={() => handleSendMessage('Find 1 hour of free time this afternoon')}
                  className="text-left text-xs p-2 rounded-lg bg-white/80 hover:bg-white text-gray-700 border border-gray-100 transition shadow-2xs hover:border-[#a8dadc]"
                >
                  🔍 Find 1 hour free time this afternoon
                </button>
              </div>
            </div>

            <div className="sidebar-date flex flex-col items-center gap-1">
              <div className="text-xs text-gray-400 font-medium">CURRENT DATE</div>
              <div className="text-sm font-bold text-[#1d3557]">{todayDateFormatted}</div>
            </div>
          </div>

          {/* Chat Main Area */}
          <div className="chat-main">
            {/* Top Bar */}
            <div className="h-16 border-b border-gray-100 px-6 flex items-center justify-between bg-white/80 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                <span className="font-bold text-sm text-[#1d3557]">Callie AI Active</span>
                <span className="text-xs text-gray-400">· Powered by Gemini & Google Calendar</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDiagnostics(true)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition flex items-center gap-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Render Docs
                </button>
                {!authStatus.authenticated ? (
                  <button
                    onClick={handleGoogleLogin}
                    className="px-3 py-1 rounded-lg text-xs font-semibold text-[#1d3557] bg-[#b7e4c7] hover:bg-[#a8dadc] transition"
                  >
                    Connect Real Calendar
                  </button>
                ) : (
                  <span className="text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md font-medium border border-emerald-100">
                    Synced: {authStatus.user?.email || 'Active'}
                  </span>
                )}
              </div>
            </div>

            {/* Message Stream */}
            <div className="chat-messages" ref={chatMessagesRef}>
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`message-row ${msg.sender === 'ai' ? 'ai-row' : 'user-row'}`}
                >
                  <div
                    className={`message-bubble ${
                      msg.sender === 'ai' ? 'ai-bubble' : 'user-bubble'
                    }`}
                  >
                    <FormattedMessage text={msg.text} isAi={msg.sender === 'ai'} />
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="message-row ai-row">
                  <div className="message-bubble ai-bubble flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce"></span>
                    <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce [animation-delay:0.2s]"></span>
                    <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce [animation-delay:0.4s]"></span>
                    <p style={{ fontStyle: 'italic', opacity: 0.8, marginLeft: '4px' }}>
                      Callie is updating your schedule...
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input Bar */}
            <div className="chat-input-area bg-white">
              <input
                type="text"
                placeholder={isListening ? 'Listening to your voice...' : 'Type your plan (e.g. Schedule gym tomorrow at 6 PM)...'}
                className="chat-input"
                value={inputValue}
                disabled={isLoading}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
              />

              {/* Voice recognition button */}
              <button
                type="button"
                onClick={toggleVoiceInput}
                title={isListening ? 'Stop recording' : 'Voice input'}
                className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all ${
                  isListening
                    ? 'bg-rose-500 text-white border-rose-600 animate-pulse shadow-md'
                    : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                }`}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {/* Send Button */}
              <button
                type="button"
                className="btn-send cursor-pointer"
                onClick={() => handleSendMessage()}
                disabled={isLoading || !inputValue.trim()}
              >
                <Send className="w-5 h-5 ml-0.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EVENTS DRAWER MODAL */}
      {showEventsDrawer && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-md bg-white h-full shadow-2xl p-6 flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-lg text-[#1d3557]">Calendar Events</h3>
              </div>
              <button
                onClick={() => setShowEventsDrawer(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-3">
              {loadingEvents ? (
                <div className="py-8 text-center text-gray-400 text-sm">Loading events...</div>
              ) : calendarEvents.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">No upcoming events found.</div>
              ) : (
                calendarEvents.map((evt, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-gray-50 border border-gray-200/80">
                    <div className="font-semibold text-sm text-[#1d3557]">{evt.summary}</div>
                    <div className="text-xs text-emerald-700 font-medium mt-1 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {evt.start?.dateTime
                        ? new Date(evt.start.dateTime).toLocaleString([], {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : evt.start?.date || 'All Day'}
                    </div>
                    {evt.description && (
                      <div className="text-xs text-gray-500 mt-1 line-clamp-2">{evt.description}</div>
                    )}
                  </div>
                ))
              )}
            </div>

            <button
              onClick={fetchEvents}
              className="mt-2 w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh Calendar
            </button>
          </div>
        </div>
      )}

      {/* RENDER AUTH & DEPLOYMENT DIAGNOSTICS MODAL */}
      {showDiagnostics && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700 font-bold">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-[#1d3557]">
                    Why Google Auth Returned "Invalid" on Render & How It Is Fixed
                  </h3>
                  <p className="text-xs text-gray-500">
                    Detailed root cause diagnosis and 1-click copyable solutions for your GitHub repository
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDiagnostics(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
              {/* Root Causes Checklist */}
              <div className="space-y-3">
                <h4 className="font-bold text-gray-800 text-base flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  The 4 Authentication Bugs in Your Render Deployment:
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl border border-rose-100 bg-rose-50/50">
                    <div className="font-bold text-rose-900 text-xs uppercase tracking-wider mb-1">
                      1. Redirect URI Mismatch
                    </div>
                    <p className="text-xs text-rose-800 leading-relaxed">
                      Google OAuth requires that the URL requested during token exchange exactly matches
                      "Authorized redirect URIs" in Google Cloud Console. Your env had <code>api.gocal.us</code>, but
                      the app runs on Render's <code>onrender.com</code> subdomain.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-amber-100 bg-amber-50/50">
                    <div className="font-bold text-amber-900 text-xs uppercase tracking-wider mb-1">
                      2. Reverse Proxy HTTP vs HTTPS
                    </div>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      Render terminates SSL at its load balancer. Flask receives internal traffic over HTTP.
                      Without <code>ProxyFix</code>, <code>oauthlib</code> throws <code>InsecureTransportError</code> or
                      rejects the HTTP callback scheme.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-blue-100 bg-blue-50/50">
                    <div className="font-bold text-blue-900 text-xs uppercase tracking-wider mb-1">
                      3. SameSite Session Cookie Dropped
                    </div>
                    <p className="text-xs text-blue-800 leading-relaxed">
                      When Google redirects back from accounts.google.com, browsers drop default Flask cookies without
                      <code>SESSION_COOKIE_SAMESITE="None"</code> and <code>Secure=True</code>. As a result, <code>state</code> and PKCE verifier become <code>None</code>!
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-purple-100 bg-purple-50/50">
                    <div className="font-bold text-purple-900 text-xs uppercase tracking-wider mb-1">
                      4. Frontend GIS Button Disconnect
                    </div>
                    <p className="text-xs text-purple-800 leading-relaxed">
                      The frontend rendered a Google Identity Services button that only logged a JWT to <code>console.log</code> and never requested Google Calendar scopes. The only OAuth link was hardcoded to <code>localhost:5000</code>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Exact Google Cloud Console Step */}
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50">
                <h4 className="font-bold text-emerald-900 flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Action Required in Google Cloud Console:
                </h4>
                <ol className="list-decimal list-inside space-y-1.5 text-xs text-emerald-800">
                  <li>
                    Open{' '}
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-semibold"
                    >
                      Google Cloud Console &rarr; APIs & Services &rarr; Credentials
                    </a>
                  </li>
                  <li>Click on your OAuth 2.0 Web Client ID (Client ID: <code>261130417939-bmck...</code>)</li>
                  <li>
                    Under <strong>Authorized redirect URIs</strong>, add YOUR exact Render URL:
                    <div className="my-1.5 p-2 bg-white rounded border border-emerald-300 font-mono text-emerald-900 select-all">
                      https://&lt;your-render-service&gt;.onrender.com/api/auth/callback
                    </div>
                    (Also keep <code>https://api.gocal.us/api/auth/callback</code> if using custom domain)
                  </li>
                  <li>Click <strong>Save</strong>.</li>
                </ol>
              </div>

              {/* Code Snippets Tabs */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-gray-800 text-xs uppercase tracking-wider">
                    Fixed Code Files for Your GitHub Repository
                  </div>
                  <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg flex-wrap">
                    <button
                      onClick={() => setActiveCodeTab('app')}
                      className={`px-2.5 py-1 rounded text-xs font-semibold ${
                        activeCodeTab === 'app' ? 'bg-white shadow-2xs text-[#1d3557]' : 'text-gray-600'
                      }`}
                    >
                      app.py
                    </button>
                    <button
                      onClick={() => setActiveCodeTab('google')}
                      className={`px-2.5 py-1 rounded text-xs font-semibold ${
                        activeCodeTab === 'google' ? 'bg-white shadow-2xs text-[#1d3557]' : 'text-gray-600'
                      }`}
                    >
                      google_service.py
                    </button>
                    <button
                      onClick={() => setActiveCodeTab('ai_assistant')}
                      className={`px-2.5 py-1 rounded text-xs font-semibold ${
                        activeCodeTab === 'ai_assistant' ? 'bg-white shadow-2xs text-[#1d3557]' : 'text-gray-600'
                      }`}
                    >
                      ai_assistant.py
                    </button>
                    <button
                      onClick={() => setActiveCodeTab('requirements')}
                      className={`px-2.5 py-1 rounded text-xs font-semibold ${
                        activeCodeTab === 'requirements' ? 'bg-white shadow-2xs text-[#1d3557]' : 'text-gray-600'
                      }`}
                    >
                      requirements.txt
                    </button>
                  </div>
                </div>

                <div className="relative rounded-xl bg-gray-900 text-gray-100 p-4 font-mono text-xs overflow-x-auto max-h-60 border border-gray-800">
                  <button
                    onClick={() => copyToClipboard(codeSnippets[activeCodeTab], activeCodeTab)}
                    className="absolute top-3 right-3 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs flex items-center gap-1 transition"
                  >
                    {copiedTab === activeCodeTab ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy File</span>
                      </>
                    )}
                  </button>
                  <pre>{codeSnippets[activeCodeTab]}</pre>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowDiagnostics(false)}
                className="px-5 py-2 rounded-xl bg-[#1d3557] text-white text-xs font-semibold hover:bg-[#162740] transition"
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRIVACY POLICY MODAL */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-gray-900 text-base">Privacy Policy</h3>
              </div>
              <button
                onClick={() => setShowPrivacyModal(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs text-gray-600 leading-relaxed">
              <p className="text-gray-400 font-medium">Last updated: October 2026</p>
              
              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1">1. Overview</h4>
                <p>
                  Callie (&quot;we&quot;, &quot;our&quot;, or &quot;the service&quot;) is an AI-powered calendar companion built to help students and busy individuals organize their daily schedules and find open windows for productivity and relaxation.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1">2. Google User Data & Calendar Access</h4>
                <p className="mb-1.5">
                  When you connect your Google Account, Callie requests access to Google Calendar API data solely to fulfill your direct conversational commands:
                </p>
                <ul className="list-disc list-inside space-y-1 text-gray-700">
                  <li>Displaying your agenda when you ask what is on your schedule.</li>
                  <li>Adding, rescheduling, or deleting events when you explicitly request it.</li>
                  <li>Analyzing open gaps between events to suggest free time and break windows.</li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1">3. Data Sharing & Security</h4>
                <p>
                  We <strong>never sell, rent, or trade</strong> your Google Calendar data to any advertisers or third parties. Authentication tokens are stored in secure HTTP-only cookies and are never shared.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1">4. Revoking Permissions</h4>
                <p>
                  You can disconnect Callie or revoke access at any time directly through your{' '}
                  <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-700 font-semibold underline inline-flex items-center gap-0.5"
                  >
                    Google Account Permissions <ExternalLink className="w-3 h-3" />
                  </a>.
                </p>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowPrivacyModal(false)}
                className="px-5 py-2 rounded-xl bg-[#1d3557] text-white text-xs font-semibold hover:bg-[#162740] transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TERMS OF SERVICE MODAL */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Info className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-gray-900 text-base">Terms of Service</h3>
              </div>
              <button
                onClick={() => setShowTermsModal(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs text-gray-600 leading-relaxed">
              <p className="text-gray-400 font-medium">Last updated: October 2026</p>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1">1. Acceptance of Terms</h4>
                <p>
                  By accessing or using Callie Calendar Assistant, you agree to these Terms of Service. If you do not agree, please do not connect your Google account.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1">2. Permitted Use</h4>
                <p>
                  Callie is provided for personal scheduling and agenda management. You are responsible for reviewing scheduled appointments and verifying that moved or created events reflect your desired timings.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm mb-1">3. Disclaimers</h4>
                <p>
                  The service is provided &quot;as is&quot; without warranties of any kind. While Callie strives for high accuracy, the developers are not liable for missed appointments or scheduling discrepancies.
                </p>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowTermsModal(false)}
                className="px-5 py-2 rounded-xl bg-[#1d3557] text-white text-xs font-semibold hover:bg-[#162740] transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
