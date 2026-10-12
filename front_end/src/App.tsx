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

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'home' | 'chat'>('home');
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
  const [activeCodeTab, setActiveCodeTab] = useState<'app' | 'google' | 'requirements'>('app');

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
  }, []);

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
from calendar_controller import list_upcoming_events
from ai_assistant import process_prompt

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SESSION_SECRET", "dev_secret_key_123")

# 1. Reverse proxy fix: Essential for Render HTTPS termination
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)

# 2. Fix cookie dropping on cross-site Google redirect
app.config.update(
    SESSION_COOKIE_SAMESITE="None",
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
)

CORS(app, supports_credentials=True, origins=os.getenv("ALLOWED_ORIGINS", "*").split(","))

def get_redirect_uri():
    configured = os.getenv("GOOGLE_REDIRECT_URI")
    if configured and configured.startswith("http"):
        return configured
    scheme = request.headers.get('X-Forwarded-Proto', request.scheme)
    return f"{scheme}://{request.host}/api/auth/callback"

@app.route('/login')
def login():
    flow = get_oauth_flow(redirect_uri=get_redirect_uri())
    auth_url, state = flow.authorization_url(access_type='offline', prompt='consent', include_granted_scopes='true')
    session['state'] = state
    if flow.code_verifier:
        session['code_verifier'] = flow.code_verifier
    return redirect(auth_url)

@app.route('/api/auth/callback')
def callback():
    state = session.get('state')
    url = request.url
    # Force https scheme if proxied
    if request.headers.get('X-Forwarded-Proto') == 'https' and url.startswith('http://'):
        url = url.replace('http://', 'https://', 1)
        
    flow = get_oauth_flow(state=state, redirect_uri=get_redirect_uri())
    if session.get('code_verifier'):
        flow.code_verifier = session.get('code_verifier')
    flow.fetch_token(authorization_response=url)
    
    creds = flow.credentials
    session['tokens'] = {
        'access_token': creds.token,
        'refresh_token': creds.refresh_token or session.get('tokens', {}).get('refresh_token'),
    }
    frontend_url = os.getenv("FRONTEND_URL", "/")
    return redirect(f"{frontend_url}?auth=success")`,

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
                    </div>
                  )}
                </div>
              </div>
            </div>

            <p className="scroll-down-hint mb-4 cursor-pointer" onClick={scrollToPreferences}>
              Scroll down for Preferences &darr;
            </p>
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
                    <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.text}</p>
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
                  <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
                    <button
                      onClick={() => setActiveCodeTab('app')}
                      className={`px-2.5 py-1 rounded text-xs font-semibold ${
                        activeCodeTab === 'app' ? 'bg-white shadow-2xs text-[#1d3557]' : 'text-gray-600'
                      }`}
                    >
                      back_end/app.py
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
    </>
  );
}
