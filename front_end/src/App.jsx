import React, { useState, useRef, useEffect } from "react";

const API_BASE_URL = "https://gocal.onrender.com";

function App() {
  const [currentScreen, setCurrentScreen] = useState("home");
  const [messages, setMessages] = useState([
    { sender: "ai", text: "Hi there! I'm Callie, how can I help you organize your day?" }
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSnackDisabled, setIsSnackDisabled] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState(null);

  const preferencesRef = useRef(null);
  const chatMessagesRef = useRef(null);

  const scrollToPreferences = () => {
    preferencesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Check auth and auto-open Callie chat if redirected from Google login
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") {
      setIsAuthenticated(true);
      setCurrentScreen("chat");
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("auth") === "error") {
      setAuthError(params.get("error_details") || "Google Sign-in failed");
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/status`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setIsAuthenticated(data.authenticated);
      }
    } catch (e) {
      console.warn("Could not check auth status", e);
    }
  };

  const handleLogin = () => {
    window.location.href = `${API_BASE_URL}/login?redirect_to=${encodeURIComponent(window.location.origin)}`;
  };

  const handleSendMessage = async () => {
    if (inputValue.trim() === "" || isLoading) return;
    const userMessageText = inputValue;
    const userMessage = { sender: "user", text: userMessageText };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: userMessageText }),
      });

      let data;
      try {
        data = await response.json();
      } catch (e) {
        const text = await response.text();
        throw new Error(`Server returned: ${text || response.status}`);
      }

      if (response.ok) {
        setMessages((prev) => [...prev, { sender: "ai", text: data.reply }]);
      } else if (response.status === 401) {
        setMessages((prev) => [
          ...prev,
          {
            sender: "ai",
            text: "Your session expired. Please log in with Google on the home page first.",
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: "ai", text: data.error || "Sorry, I had trouble with that request." },
        ]);
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        { sender: "ai", text: `Connection issue: ${error.message || "Failed to reach Callie"}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") handleSendMessage();
  };

  // Helper to format text with bold markdown and line breaks
  const renderFormattedText = (text) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} style={{ color: "#111827", fontWeight: "700" }}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const todayDateFormatted = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <>
      {authError && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: "12px", textAlign: "center", fontSize: "14px" }}>
          ⚠️ {authError}
        </div>
      )}

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

            <div className="header">
              <h1 className="logo">GoCal</h1>
            </div>

            <div className="hero-section">
              <h2 className="main-title">Welcome !</h2>
              <div className="about-section">
                <h3 className="subtitle">What we do</h3>
                <p className="description">
                  An intelligent AI scheduling companion that syncs natural language instructions with your calendar.
                </p>
              </div>

              <div className="action-buttons" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <button type="button" onClick={scrollToPreferences} className="btn-primary">
                  Get Started
                </button>

                {isAuthenticated ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ color: "#059669", fontWeight: "600", fontSize: "14px" }}>
                      ✅ Google Calendar Connected
                    </div>
                    <button
                      type="button"
                      onClick={() => setCurrentScreen("chat")}
                      className="btn-primary"
                      style={{ marginTop: "8px", padding: "10px 24px", fontSize: "15px" }}
                    >
                      Open Callie Chat &rarr;
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleLogin}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      background: "#ffffff",
                      border: "1px solid #dadce0",
                      borderRadius: "24px",
                      padding: "10px 22px",
                      fontSize: "14px",
                      fontWeight: "600",
                      color: "#3c4043",
                      cursor: "pointer",
                      boxShadow: "0 1px 3px rgba(60,64,67,0.1)",
                      transition: "background-color 0.2s, box-shadow 0.2s"
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                    </svg>
                    <span>Sign in with Google</span>
                  </button>
                )}
              </div>
            </div>

            <p className="scroll-down-hint">Scroll down for Preferences &darr;</p>
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
                  <label style={{ display: "flex", alignItems: "center", gap: "5px", color: "rgb(107, 114, 128)" }}>
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
          </div>
        </div>
      )}

      {currentScreen === "chat" && (
        <div className="chat-layout">
          <div className="chat-sidebar">
            <button type="button" onClick={() => setCurrentScreen("home")} className="btn-back">
              &larr; Back
            </button>
            <h1 className="logo sidebar-logo">GoCal</h1>
            <div className="mascot-section">
              <div className={`mascot-circle ${isLoading ? "speaking" : ""}`}>
                <span>Callie</span>
              </div>
              <p className="mascot-text">Keep Calm and ask Callie about your calendar</p>
            </div>
            <div className="sidebar-date">{todayDateFormatted}</div>
          </div>

          <div className="chat-main">
            <div className="chat-messages" ref={chatMessagesRef}>
              {messages.map((msg, index) => (
                <div key={index} className={`message-row ${msg.sender === "ai" ? "ai-row" : "user-row"}`}>
                  <div
                    className={`message-bubble ${msg.sender === "ai" ? "ai-bubble" : "user-bubble"}`}
                    style={{ whiteSpace: "pre-wrap", lineHeight: "1.7" }}
                  >
                    {renderFormattedText(msg.text)}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="message-row ai-row">
                  <div className="message-bubble ai-bubble">
                    <p style={{ fontStyle: "italic", opacity: 0.7 }}>Callie is checking your calendar...</p>
                  </div>
                </div>
              )}
            </div>

            <div className="chat-input-area">
              <input
                type="text"
                placeholder="Type your plan..."
                className="chat-input"
                value={inputValue}
                disabled={isLoading}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <button type="button" className="btn-send" onClick={handleSendMessage} disabled={isLoading}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
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