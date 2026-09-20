import React, { useState, useRef, useEffect } from "react";

function App() {
  const [currentScreen, setCurrentScreen] = useState("home");
  const [messages, setMessages] = useState([
    { sender: "ai", text: "Hi there! How can I help you organize your day?" }
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isSnackDisabled, setIsSnackDisabled] = useState(false);
  
  const preferencesRef = useRef(null);
  const chatMessagesRef = useRef(null);

  const scrollToPreferences = () => {
    preferencesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [messages]);

  // Google Sign-In tugmasini avtomatik chiqarish uchun hook
  useEffect(() => {
    if (currentScreen === "home" && window.google) {
      try {
        window.google.accounts.id.initialize({
          client_id: "261130417939-bmck13fp7ncmt6f19vngk5nlltukcidg.apps.googleusercontent.com",
          callback: (response) => console.log("Google Login Response:", response),
        });
        window.google.accounts.id.renderButton(
          document.getElementById("buttonDiv"),
          { theme: "outline", size: "large", type: "standard", width: "250", locale: "en" }
        );
      } catch (error) {
        console.error("Google Auth xatosi:", error);
      }
    }
  }, [currentScreen]);

  const handleSendMessage = () => {
    if (inputValue.trim() === "") return;

    const userMessage = { sender: "user", text: inputValue };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { sender: "ai", text: `Got it! I am organizing "${userMessage.text}" into your Google Calendar right now.` }
      ]);
    }, 1000);
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  const todayDateFormatted = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return (
    <>
      {/* HOME & PREFERENCES SCREEN */}
      {currentScreen === "home" && (
        <div id="home-screen" style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          <div className="hero-container">
            
            {/* Orqa fondagi xira taqvimlar */}
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
                <p className="login-hint">Sign up / Log in</p>
                
                {/* Google Sign In shu id'ga kelib joylashadi */}
                <div id="buttonDiv" style={{ marginTop: "10px" }}></div>
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
              <a href="#home">Home</a>
              <a href="#privacy">Privacy Policy</a>
              <a href="#contact">Contact us</a>
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
              onClick={() => setCurrentScreen("home")}
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
                    <p>{msg.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="chat-input-area">
              <input
                type="text"
                placeholder="Type your plan..."
                className="chat-input"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <button type="button" className="btn-send" onClick={handleSendMessage}>
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