import React, { useState, useRef, useEffect } from "react";

// Determine API base URL dynamically
const getApiBaseUrl = () => {
  if (typeof window !== "undefined") {
    // If running on custom domain or render, use relative path if proxied, or env var
    if (import.meta.env?.VITE_API_URL) {
      return import.meta.env.VITE_API_URL.replace(/\/$/, "");
    }
    // Default to relative /api (works when frontend proxies backend or same domain)
    // If backend is on another Render domain (e.g. gocal.onrender.com), fallback:
    const hostname = window.location.hostname;
    if (hostname.includes("onrender.com")) {
      return "https://gocal.onrender.com";
    }
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:5000";
    }
  }
  return "";
};

function App() {
  const [currentScreen, setCurrentScreen] = useState(() => {
    if (typeof window !== "undefined") {
      const path = window.location.pathname.toLowerCase();
      if (path.includes("privacy")) return "privacy";
      if (path.includes("terms")) return "terms";
    }
    return "home";
  });

  const [messages, setMessages] = useState([
    { sender: "ai", text: "Hi there! I'm Callie, how can I help you organize your day?" }
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSnackDisabled, setIsSnackDisabled] = useState(false);
  const [authStatus, setAuthStatus] = useState({ authenticated: false, user: null });
  const [authNotification, setAuthNotification] = useState(null);

  const preferencesRef = useRef(null);
  const chatMessagesRef = useRef(null);

  const navigateTo = (screen) => {
    setCurrentScreen(screen);
    if (screen === "privacy") {
      window.history.pushState({}, "", "/privacy");
    } else if (screen === "terms") {
      window.history.pushState({}, "", "/terms");
    } else {
      window.history.pushState({}, "", "/");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      if (path.includes("privacy")) setCurrentScreen("privacy");
      else if (path.includes("terms")) setCurrentScreen("terms");
      else setCurrentScreen("home");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const scrollToPreferences = () => {
    preferencesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Check URL query parameters for auth response
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authParam = urlParams.get("auth");
    if (authParam === "success") {
      setAuthNotification({
        type: "success",
        message: "Google Calendar successfully connected! Callie is now synced with your calendar."
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (authParam === "error") {
      setAuthNotification({
        type: "error",
        message: "Failed to connect Google Calendar. Please check OAuth credentials."
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Initiate Google OAuth login
  const handleGoogleLogin = async () => {
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/auth/url`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data.authUrl) {
          window.location.href = data.authUrl;
          return;
        }
      }
      // Fallback direct login endpoint
      window.location.href = `${baseUrl}/login`;
    } catch (err) {
      const baseUrl = getApiBaseUrl();
      window.location.href = `${baseUrl}/login`;
    }
  };

  // Connects to Flask backend
  const handleSendMessage = async () => {
    if (inputValue.trim() === "" || isLoading) return;

    const userMessageText = inputValue;
    const userMessage = { sender: "user", text: userMessageText };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: userMessageText }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessages((prev) => [
          ...prev,
          { sender: "ai", text: data.reply }
        ]);
      } else if (response.status === 401) {
        setMessages((prev) => [
          ...prev,
          {
            sender: "ai",
            text: "You are not logged in with Google yet. Please click 'Connect Google Calendar' on the home page."
          }
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: "ai", text: data.error || "I ran into a hiccup with that request. Let's try again!" }
        ]);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { sender: "ai", text: "Network connection error. Please verify the backend server is reachable." }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  const todayDateFormatted = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <>
      {/* Toast Notification */}
      {authNotification && (
        <div style={{
          position: "fixed",
          top: "20px",
          right: "20px",
          zIndex: 9999,
          padding: "14px 20px",
          borderRadius: "10px",
          background: authNotification.type === "success" ? "#ecfdf5" : "#fef2f2",
          border: `1px solid ${authNotification.type === "success" ? "#a7f3d0" : "#fecaca"}`,
          color: authNotification.type === "success" ? "#065f46" : "#991b1b",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          fontSize: "14px",
          fontWeight: "600",
        }}>
          <span>{authNotification.message}</span>
          <button
            onClick={() => setAuthNotification(null)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", marginLeft: "10px" }}
          >
            &times;
          </button>
        </div>
      )}

      {/* HOME & PREFERENCES SCREEN */}
      {currentScreen === "home" && (
        <div>
          <div className="hero-container">
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
              <div className="cal-header" style={{ width: "70%" }}></div>
              <div className="cal-grid">
                <i></i><i></i><i className="active"></i><i></i><i></i><i></i><i></i>
                <i></i><i></i><i></i><i></i><i></i><i className="active"></i><i></i>
                <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
                <i></i><i className="active"></i><i></i><i></i><i></i><i></i><i></i>
                <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
              </div>
            </div>

            <div className="header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: "1000px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <img src="/GoCal-Logo.png" alt="GoCal Logo" style={{ height: "36px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <h1 className="logo" style={{ fontSize: "28px", fontWeight: "800", color: "#1d3557" }}>GoCal</h1>
              </div>
              <div style={{ display: "flex", gap: "18px", alignItems: "center" }}>
                <a
                  href="/privacy"
                  onClick={(e) => { e.preventDefault(); navigateTo("privacy"); }}
                  style={{ color: "#457b9d", fontWeight: "600", textDecoration: "none", fontSize: "14px" }}
                >
                  Privacy Policy
                </a>
                <a
                  href="/terms"
                  onClick={(e) => { e.preventDefault(); navigateTo("terms"); }}
                  style={{ color: "#457b9d", fontWeight: "600", textDecoration: "none", fontSize: "14px" }}
                >
                  Terms of Service
                </a>
              </div>
            </div>

            <div className="hero-section">
              <h2 className="main-title">Welcome !</h2>
              <div className="about-section">
                <h3 className="subtitle">What we do</h3>
                <p className="description">
                  An intelligent AI scheduling companion that syncs natural language instructions with your Google Calendar.
                </p>
              </div>

              <div className="action-buttons">
                <button type="button" onClick={scrollToPreferences} className="btn-primary">
                  Get Started &rarr;
                </button>

                <p className="login-hint" style={{ marginTop: "12px", textTransform: "uppercase", fontSize: "11px", letterSpacing: "1px", color: "#64748b" }}>
                  Google Calendar Integration
                </p>

                {/* Direct Google OAuth Login Button */}
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "10px",
                    padding: "12px 24px",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "10px",
                    color: "#1e293b",
                    fontWeight: "600",
                    fontSize: "15px",
                    cursor: "pointer",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
                    marginTop: "6px"
                  }}
                >
                  <svg style={{ width: "20px", height: "20px" }} viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                  <span>Connect Google Calendar</span>
                </button>
              </div>
            </div>

            <p className="scroll-down-hint">Scroll down to learn how it works & set preferences &darr;</p>
          </div>

          {/* PUBLIC APPLICATION PURPOSE & GOOGLE COMPLIANCE SECTION */}
          <div style={{ maxWidth: "900px", margin: "40px auto", padding: "0 20px" }}>
            <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "32px", boxShadow: "0 4px 16px rgba(0,0,0,0.03)" }}>
              <div style={{ textAlign: "center", marginBottom: "24px" }}>
                <span style={{ background: "#d1fae5", color: "#065f46", fontSize: "11px", fontWeight: "700", textTransform: "uppercase", padding: "4px 12px", borderRadius: "20px", letterSpacing: "1px" }}>
                  Google Calendar Integration
                </span>
                <h2 style={{ fontSize: "26px", fontWeight: "800", color: "#1d3557", marginTop: "12px" }}>
                  How GoCal & Callie Assist Your Schedule
                </h2>
                <p style={{ color: "#475569", fontSize: "15px", marginTop: "8px", maxWidth: "680px", margin: "8px auto 0" }}>
                  GoCal is an artificial intelligence-assisted scheduling application featuring Callie. GoCal connects with your Google Calendar through official Google OAuth 2.0 to make managing commitments effortless.
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "20px", marginTop: "24px" }}>
                <div style={{ background: "#f8fafc", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                  <h3 style={{ color: "#1d3557", fontSize: "16px", fontWeight: "700", marginBottom: "8px" }}>📅 1. Instant Agenda View</h3>
                  <p style={{ color: "#64748b", fontSize: "13.5px", lineHeight: "1.6" }}>
                    Callie reads your Google Calendar events to display clean, vertically formatted daily and weekly summaries when you ask <em>"what's my schedule?"</em>.
                  </p>
                </div>
                <div style={{ background: "#f8fafc", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                  <h3 style={{ color: "#1d3557", fontSize: "16px", fontWeight: "700", marginBottom: "8px" }}>🔄 2. Conversational Rescheduling</h3>
                  <p style={{ color: "#64748b", fontSize: "13.5px", lineHeight: "1.6" }}>
                    Move or adjust appointments hands-free (e.g. <em>"move Spanish to 8pm"</em> or <em>"cancel gym"</em>). Callie updates the event directly on your calendar.
                  </p>
                </div>
                <div style={{ background: "#f8fafc", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                  <h3 style={{ color: "#1d3557", fontSize: "16px", fontWeight: "700", marginBottom: "8px" }}>✨ 3. Free Time Discovery</h3>
                  <p style={{ color: "#64748b", fontSize: "13.5px", lineHeight: "1.6" }}>
                    Ask Callie <em>"when this week is a good time to see my friends?"</em> and she analyzes open gaps between commitments to find optimal relaxation windows.
                  </p>
                </div>
              </div>

              <div style={{ marginTop: "24px", padding: "16px 20px", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <strong style={{ color: "#065f46", fontSize: "14px", display: "block" }}>🔒 Privacy Protection & Data Safety</strong>
                  <span style={{ color: "#047857", fontSize: "13px" }}>
                    We never sell, rent, or trade your Google Calendar data. You can disconnect GoCal at any time.
                  </span>
                </div>
                <div style={{ display: "flex", gap: "12px" }}>
                  <a href="/privacy" onClick={(e) => { e.preventDefault(); navigateTo("privacy"); }} style={{ color: "#065f46", fontWeight: "700", fontSize: "13px", textDecoration: "underline" }}>
                    Privacy Policy
                  </a>
                  <a href="/terms" onClick={(e) => { e.preventDefault(); navigateTo("terms"); }} style={{ color: "#065f46", fontWeight: "700", fontSize: "13px", textDecoration: "underline" }}>
                    Terms of Service
                  </a>
                </div>
              </div>
            </div>
          </div>

          <div ref={preferencesRef} className="preferences-section">
            <div className="g-form-card">
              <h2>Welcome! (New User)</h2>
              <p>Please tell us your scheduling preferences so we can optimize your calendar.</p>

              <div className="form-group">
                <label>Sleep Schedule (Bedtime)</label>
                <input type="time" defaultValue="23:00" />
              </div>

              <div className="form-group">
                <label>Gym Schedule</label>
                <div style={{ display: "flex", gap: "10px" }}>
                  <select defaultValue="3-4 times a week">
                    <option>1-2 times a week</option>
                    <option>3-4 times a week</option>
                    <option>5-6 times a week</option>
                    <option>Everyday</option>
                  </select>
                  <input type="time" defaultValue="18:00" />
                  <input type="number" placeholder="Mins" style={{ width: "100px" }} />
                </div>
              </div>

              <div className="form-group">
                <label>Daily Meals</label>
                <div style={{ display: "flex", gap: "10px" }}>
                  <select defaultValue="3 meals a day">
                    <option>2 meals a day</option>
                    <option>3 meals a day</option>
                    <option>4 meals a day</option>
                    <option>5+ meals a day</option>
                  </select>
                  <input type="time" defaultValue="13:00" />
                  <input type="number" placeholder="Mins" style={{ width: "100px" }} />
                </div>
              </div>

              <div className="form-group">
                <label>Typical Snack Time</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input type="time" defaultValue="16:00" disabled={isSnackDisabled} />
                  <label style={{ display: "flex", alignItems: "center", gap: "5px", fontWeight: "normal", margin: "0", cursor: "pointer", color: "rgb(107, 114, 128)" }}>
                    <input
                      type="checkbox"
                      style={{ width: "auto", margin: "0" }}
                      onChange={(e) => setIsSnackDisabled(e.target.checked)}
                    />{" "}
                    No snack
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  window.scrollTo(0, 0);
                  setCurrentScreen("chat");
                }}
                className="btn-primary"
                style={{ fontSize: "16px", padding: "12px 25px", width: "100%", marginTop: "10px" }}
              >
                Save & Continue to Chat
              </button>
            </div>

            <div className="footer">
              <a href="#home" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                Home
              </a>
              <a href="/privacy" onClick={(e) => { e.preventDefault(); navigateTo("privacy"); }}>
                Privacy Policy
              </a>
              <a href="/terms" onClick={(e) => { e.preventDefault(); navigateTo("terms"); }}>
                Terms of Service
              </a>
              <a href="https://github.com/Adam-S-Amir/GoCal" target="_blank" rel="noreferrer">
                GitHub Repository
              </a>
            </div>
          </div>
        </div>
      )}

      {/* FULL-PAGE PRIVACY POLICY (for https://gocal.us/privacy) */}
      {currentScreen === "privacy" && (
        <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "40px 20px" }}>
          <div style={{ maxWidth: "760px", margin: "0 auto", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "40px", boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0", paddingBottom: "20px", marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <img src="/GoCal-Logo.png" alt="Logo" style={{ height: "36px" }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <span style={{ fontSize: "24px", fontWeight: "800", color: "#1d3557" }}>GoCal</span>
              </div>
              <button
                onClick={() => navigateTo("home")}
                style={{ background: "#f1f5f9", border: "none", padding: "8px 16px", borderRadius: "8px", color: "#1d3557", fontWeight: "600", cursor: "pointer" }}
              >
                &larr; Back to GoCal
              </button>
            </div>

            <h1 style={{ fontSize: "28px", fontWeight: "800", color: "#1d3557", marginBottom: "8px" }}>Privacy Policy</h1>
            <p style={{ color: "#94a3b8", fontSize: "13px", marginBottom: "20px" }}>Last updated: October 13, 2026</p>

            <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "16px", borderRadius: "10px", color: "#065f46", fontSize: "14px", lineHeight: "1.6", marginBottom: "24px" }}>
              <strong>Plain English Summary:</strong> GoCal and its AI companion Callie only access your Google Calendar to fulfill your direct scheduling instructions. We never sell your data, never share it with advertisers, and you can revoke access at any time.
            </div>

            <div style={{ color: "#334155", fontSize: "14px", lineHeight: "1.7" }}>
              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#1d3557", marginTop: "20px", marginBottom: "8px" }}>1. Overview</h2>
              <p>GoCal is an intelligent calendar assistant powered by conversational AI. We respect your privacy and are committed to protecting any information processed while using our service.</p>

              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#1d3557", marginTop: "20px", marginBottom: "8px" }}>2. Google User Data We Access</h2>
              <p>When you connect your Google Account via Google OAuth, GoCal requests access to the Google Calendar API (<code>https://www.googleapis.com/auth/calendar</code>). We access:</p>
              <ul style={{ paddingLeft: "20px", marginTop: "8px" }}>
                <li><strong>Calendar Events:</strong> Event titles, start and end dates/times, and descriptions to view schedules and calculate open windows.</li>
                <li><strong>Basic Profile Info:</strong> Your Google email and name to verify your user session.</li>
              </ul>

              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#1d3557", marginTop: "20px", marginBottom: "8px" }}>3. How Your Data Is Used</h2>
              <p>Your calendar data is used strictly to fulfill direct scheduling features you request:</p>
              <ul style={{ paddingLeft: "20px", marginTop: "8px" }}>
                <li>Displaying your upcoming daily and weekly agenda.</li>
                <li>Adding, rescheduling, and removing events based on your natural language commands.</li>
                <li>Analyzing open gaps between commitments to help you plan free time.</li>
              </ul>

              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#1d3557", marginTop: "20px", marginBottom: "8px" }}>4. Data Sharing & Security</h2>
              <p><strong>We do not sell, rent, or trade your Google Calendar data to any third parties.</strong> Authentication tokens are stored securely in encrypted HTTP-only session cookies and transmitted strictly over HTTPS. We do not use your private calendar events to train public models.</p>

              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#1d3557", marginTop: "20px", marginBottom: "8px" }}>5. Revoking Access</h2>
              <p>You can disconnect GoCal at any time by signing out or by visiting your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" style={{ color: "#059669", fontWeight: "600" }}>Google Account Security &amp; Permissions</a>.</p>
            </div>
          </div>
        </div>
      )}

      {/* FULL-PAGE TERMS OF SERVICE (for https://gocal.us/terms) */}
      {currentScreen === "terms" && (
        <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "40px 20px" }}>
          <div style={{ maxWidth: "760px", margin: "0 auto", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "40px", boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0", paddingBottom: "20px", marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <img src="/GoCal-Logo.png" alt="Logo" style={{ height: "36px" }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <span style={{ fontSize: "24px", fontWeight: "800", color: "#1d3557" }}>GoCal</span>
              </div>
              <button
                onClick={() => navigateTo("home")}
                style={{ background: "#f1f5f9", border: "none", padding: "8px 16px", borderRadius: "8px", color: "#1d3557", fontWeight: "600", cursor: "pointer" }}
              >
                &larr; Back to GoCal
              </button>
            </div>

            <h1 style={{ fontSize: "28px", fontWeight: "800", color: "#1d3557", marginBottom: "8px" }}>Terms of Service</h1>
            <p style={{ color: "#94a3b8", fontSize: "13px", marginBottom: "20px" }}>Last updated: October 13, 2026</p>

            <div style={{ color: "#334155", fontSize: "14px", lineHeight: "1.7" }}>
              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#1d3557", marginTop: "20px", marginBottom: "8px" }}>1. Acceptance of Terms</h2>
              <p>By accessing or using GoCal and Callie Calendar Assistant, you agree to these Terms of Service. If you do not agree, please do not connect your Google Account.</p>

              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#1d3557", marginTop: "20px", marginBottom: "8px" }}>2. Permitted Use</h2>
              <p>GoCal is provided for personal scheduling and agenda management. You are responsible for reviewing scheduled appointments and verifying that moved or created events reflect your desired timings.</p>

              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#1d3557", marginTop: "20px", marginBottom: "8px" }}>3. Disclaimers</h2>
              <p>The service is provided "as is" without warranties of any kind. While Callie strives for high accuracy, the developers are not liable for missed appointments or scheduling discrepancies.</p>
            </div>
          </div>
        </div>
      )}

      {/* CHAT SCREEN */}
      {currentScreen === "chat" && (
        <div className="chat-layout">
          <div className="chat-sidebar">
            <button
              type="button"
              onClick={() => navigateTo("home")}
              className="btn-back"
            >
              &larr; Back
            </button>
            <h1 className="logo sidebar-logo">GoCal</h1>

            <div className="mascot-section">
              <div className="mascot-circle">
                <span>Callie</span>
              </div>
              <p className="mascot-text">
                Keep Calm and ask Callie about your calendar
              </p>
            </div>

            <div className="sidebar-date">
              {todayDateFormatted}
            </div>
          </div>

          <div className="chat-main">
            <div className="chat-messages" ref={chatMessagesRef}>
              {messages.map((msg, index) => (
                <div key={index} className={`message-row ${msg.sender === "ai" ? "ai-row" : "user-row"}`}>
                  <div className={`message-bubble ${msg.sender === "ai" ? "ai-bubble" : "user-bubble"}`}>
                    <p style={{ whiteSpace: "pre-wrap", lineHeight: "1.6" }}>{msg.text}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="message-row ai-row">
                  <div className="message-bubble ai-bubble">
                    <p style={{ fontStyle: "italic", opacity: 0.7 }}>Callie is thinking...</p>
                  </div>
                </div>
              )}
            </div>

            <div className="chat-input-area">
              <input
                type="text"
                placeholder="Type your plan (e.g. 'what is my schedule', 'move spanish to 8pm')..."
                className="chat-input"
                value={inputValue}
                disabled={isLoading}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <button
                type="button"
                className="btn-send"
                onClick={handleSendMessage}
                disabled={isLoading}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
