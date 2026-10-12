import React, { useState, useRef, useEffect } from "react";

// Use environment variable for backend URL or fallback to current origin if served together
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

  // Check authentication status on load & check query string from OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") {
      setIsAuthenticated(true);
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
    // Redirects to Flask's OAuth login route
    window.location.href = `${API_BASE_URL}/login`;
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
      const data = await response.json();

      if (response.ok) {
        setMessages((prev) => [...prev, { sender: "ai", text: data.reply }]);
      } else if (response.status === 401) {
        setMessages((prev) => [
          ...prev,
          {
            sender: "ai",
            text: "You are not logged in with Google. Please click 'Log in with Google' on the home page first.",
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: "ai", text: data.error || "Sorry, I had trouble with that request." },
        ]);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { sender: "ai", text: "Network error connecting to Callie backend." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") handleSendMessage();
  };

  const todayDateFormatted = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <>
      {authError && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: "12px", textAlign: "center" }}>
          ⚠️ Auth Error: {authError}
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

              <div className="action-buttons">
                <button type="button" onClick={scrollToPreferences} className="btn-primary">
                  Get Started
                </button>

                {isAuthenticated ? (
                  <div style={{ marginTop: "15px", color: "#059669", fontWeight: "600" }}>
                    ✅ Google Calendar Connected!
                    <button
                      type="button"
                      onClick={() => setCurrentScreen("chat")}
                      className="btn-primary"
                      style={{ display: "block", marginTop: "10px", padding: "10px 25px", fontSize: "16px" }}
                    >
                      Open Callie Chat &rarr;
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleLogin}
                    style={{
                      marginTop: "12px",
                      background: "#fff",
                      border: "1px solid #d1d5db",
                      borderRadius: "12px",
                      padding: "12px 24px",
                      fontWeight: "600",
                      color: "#1f2937",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <span>🔐 Log in with Google Calendar</span>
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
                  <div className={`message-bubble ${msg.sender === "ai" ? "ai-bubble" : "user-bubble"}`}>
                    <p>{msg.text}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="message-row ai-row">
                  <div className="message-bubble ai-bubble">
                    <p style={{ fontStyle: "italic", opacity: 0.7 }}>Callie is updating your schedule...</p>
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