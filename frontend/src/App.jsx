import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE = "https://ai-daily-backend-ldjh.onrender.com";

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [isSignup, setIsSignup] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');

  const [taskTitle, setTaskTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [activePopup, setActivePopup] = useState(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('completed');
  const [history, setHistory] = useState([]);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [coachMessage, setCoachMessage] = useState('AI Coach reading your habits...');

  // 1. Service Worker & Native Notification Registration
  useEffect(() => {
    if ('serviceWorker' in navigator && 'Notification' in window) {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          navigator.serviceWorker.register('/sw.js').then((reg) => {
            console.log('Service Worker Registered Successfully:', reg.scope);
          });
        }
      });
    }
  }, []);

  const loadUserData = async () => {
    try {
      const histRes = await axios.get(`${API_BASE}/users/1/history`);
      const recRes = await axios.get(`${API_BASE}/users/1/recommendations`);
      const coachRes = await axios.get(`${API_BASE}/users/1/ai-coach`);
      setHistory(histRes.data);
      setAiSuggestions(recRes.data.recommendations || []);
      setCoachMessage(coachRes.data.coach_message);
    } catch (err) {
      console.error(err);
    }
  };

  // 2. Poll Notifications & Trigger Native OS Popups
  useEffect(() => {
    if (token) {
      loadUserData();
      const interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API_BASE}/notifications/`);
          if (res.data && res.data.length > 0) {
            const notif = res.data[0];
            setActivePopup(notif);

            // Trigger System Native Notification (Screen Off / Minimised alert)
            if (Notification.permission === 'granted') {
              navigator.serviceWorker.ready.then((reg) => {
                reg.showNotification(
                  notif.type === 'START' ? "⏰ Task Reminder" : "❓ Task Completion Check",
                  {
                    body: notif.message,
                    icon: '/favicon.ico',
                    tag: 'task-alert'
                  }
                );
              });
            }
          }
        } catch (err) {
          console.error("Error polling notifications", err);
        }
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [token]);

  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      if (isSignup) {
        const res = await axios.post(`${API_BASE}/signup?username=${encodeURIComponent(authUsername)}&email=${encodeURIComponent(authEmail)}&password=${encodeURIComponent(authPassword)}`);
        localStorage.setItem('token', res.data.access_token);
        setToken(res.data.access_token);
        alert("Account Created & Logged In!");
      } else {
        const res = await axios.post(`${API_BASE}/login?username=${encodeURIComponent(authEmail)}&password=${encodeURIComponent(authPassword)}`);
        localStorage.setItem('token', res.data.access_token);
        setToken(res.data.access_token);
        alert("Logged in successfully!");
      }
    } catch (err) {
      console.error(err);
      alert("Authentication Failed!");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken('');
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/tasks/?title=${taskTitle}&scheduled_time=${startTime}&expected_end_time=${endTime}&user_id=1`);
      alert("Task scheduled with Native Background Triggers!");
      setTaskTitle('');
      loadUserData();
    } catch (err) {
      console.error(err);
      alert("Error scheduling task!");
    }
  };

  const handlePopupSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.put(`${API_BASE}/tasks/${activePopup.task_id}/respond?status=${status}&user_reason=${reason}`);
      alert("Response recorded successfully!");
      setActivePopup(null);
      setReason('');
      loadUserData();
    } catch (err) {
      console.error(err);
    }
  };

  if (!token) {
    return (
      <div className="modal-overlay">
        <div className="modal-card">
          <h2 style={{ textAlign: 'center', color: '#38bdf8', marginBottom: '20px' }}>
            {isSignup ? 'Create Account' : 'Welcome Back'}
          </h2>
          <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {isSignup && (
              <div>
                <label>Username</label>
                <input 
                  type="text" 
                  value={authUsername} 
                  onChange={(e) => setAuthUsername(e.target.value)} 
                  required 
                />
              </div>
            )}
            <div>
              <label>Email Address</label>
              <input 
                type="email" 
                value={authEmail} 
                onChange={(e) => setAuthEmail(e.target.value)} 
                required 
              />
            </div>
            <div>
              <label>Password</label>
              <input 
                type="password" 
                value={authPassword} 
                onChange={(e) => setAuthPassword(e.target.value)} 
                required 
              />
            </div>
            <button type="submit" className="btn-primary">
              {isSignup ? 'Sign Up' : 'Log In'}
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: '15px', cursor: 'pointer', fontSize: '14px', color: '#94a3b8' }} onClick={() => setIsSignup(!isSignup)}>
            {isSignup ? 'Already have an account? Log In' : "Don't have an account? Sign Up"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="header-bar">
        <h2>⚡ AI Daily Life OS</h2>
        <button onClick={handleLogout} className="btn-danger">
          Logout
        </button>
      </div>

      {/* Task Creation Form */}
      <div className="card">
        <h3>➕ Schedule New Task</h3>
        <form onSubmit={handleCreateTask}>
          <div style={{ marginBottom: '15px' }}>
            <label>Task Name</label>
            <input 
              type="text" 
              placeholder="e.g., Coding, Exercise, Reading" 
              value={taskTitle} 
              onChange={(e) => setTaskTitle(e.target.value)} 
              required 
            />
          </div>
          <div className="form-grid">
            <div>
              <label>Start Time</label>
              <input 
                type="datetime-local" 
                value={startTime} 
                onChange={(e) => setStartTime(e.target.value)} 
                required 
              />
            </div>
            <div>
              <label>Expected End Time</label>
              <input 
                type="datetime-local" 
                value={endTime} 
                onChange={(e) => setEndTime(e.target.value)} 
                required 
              />
            </div>
          </div>
          <button type="submit" className="btn-primary">
            Schedule Task
          </button>
        </form>
      </div>

      {/* Generative AI Life Coach */}
      <div className="card ai-box" style={{ background: 'linear-gradient(135deg, #1e1b4b, #311042)', border: '1px solid #8b5cf6' }}>
        <h3 style={{ color: '#c084fc' }}>🤖 Generative AI Life Coach</h3>
        <p style={{ fontStyle: 'italic', color: '#e2e8f0', fontSize: '15px', lineHeight: '1.6' }}>
          "{coachMessage}"
        </p>
      </div>

      {/* AI Recommendations Box */}
      <div className="card ai-box">
        <h3>🧠 Adaptive Behavioral Insights</h3>
        <ul className="suggestion-list">
          {aiSuggestions.map((sug, idx) => (
            <li key={idx}>{sug}</li>
          ))}
        </ul>
      </div>

      {/* Task History Logs */}
      <div className="card">
        <h3>📜 Task History & Performance Logs</h3>
        <table className="custom-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>User Reason / Feedback</th>
            </tr>
          </thead>
          <tbody>
            {history.map((t) => (
              <tr key={t.id}>
                <td style={{ fontWeight: '500' }}>{t.title}</td>
                <td style={{ color: t.status === 'completed' ? '#4ade80' : t.status === 'pending' ? '#facc15' : '#f87171', fontWeight: 'bold' }}>
                  {t.status}
                </td>
                <td style={{ color: '#94a3b8' }}>{t.user_reason || 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Real-time Trigger Modal */}
      {activePopup && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3 style={{ color: activePopup.type === 'START' ? '#38bdf8' : '#facc15', marginBottom: '10px' }}>
              {activePopup.type === 'START' ? '⏰ Task Reminder' : '❓ Completion Check'}
            </h3>
            <p style={{ marginBottom: '20px', color: '#cbd5e1' }}>{activePopup.message}</p>

            {activePopup.type === 'END_CHECK' ? (
              <form onSubmit={handlePopupSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div>
                  <label>Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="completed">Completed</option>
                    <option value="missed">Missed / Not Done</option>
                    <option value="rescheduled">Rescheduled</option>
                  </select>
                </div>
                <div>
                  <label>Reason / Feedback</label>
                  <input 
                    type="text" 
                    placeholder="e.g., Felt sleepy, went out" 
                    value={reason} 
                    onChange={(e) => setReason(e.target.value)} 
                  />
                </div>
                <button type="submit" className="btn-primary" style={{ background: '#22c55e' }}>
                  Submit Response
                </button>
              </form>
            ) : (
              <button onClick={() => setActivePopup(null)} className="btn-primary">
                Got it, Starting now!
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;