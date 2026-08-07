import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = "https://ai-daily-backend-ldjh.onrender.com";

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);

  // App States
  const [taskName, setTaskName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [tasks, setTasks] = useState([]);
  const [aiTip, setAiTip] = useState("");
  const [insights, setInsights] = useState("");
  const [activeTab, setActiveTab] = useState("schedule");

  const authHeader = {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  // Routine Presets
  const presets = [
    { name: "Morning Workout & Exercise", durationMin: 45 },
    { name: "Focused Coding & Dev Block", durationMin: 120 },
    { name: "Reading & Learning Slot", durationMin: 30 },
    { name: "Night Review & Planning", durationMin: 20 },
  ];

  useEffect(() => {
    if (token) {
      fetchTasks();
      fetchAiCoach();
      fetchInsights();
    }
  }, [token]);

  const handleAuth = async (e) => {
    e.preventDefault();
    const endpoint = isSignUp ? "/signup" : "/login";
    try {
      const res = await axios.post(`${API_BASE}${endpoint}`, { 
        email: email.trim(), 
        password: password 
      });

      if (isSignUp) {
        alert("Account created successfully! 🎉 Please switch to Log In now.");
        setIsSignUp(false);
      } else {
        const accessToken = res.data.access_token || res.data.token;
        if (accessToken) {
          localStorage.setItem("token", accessToken);
          setToken(accessToken);
        } else {
          alert("Login succeeded but no token received.");
        }
      }
    } catch (err) {
      console.error("Auth error detail:", err.response);
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        alert(`Auth Error: ${detail}`);
      } else if (Array.isArray(detail)) {
        const msg = detail.map((item) => `${item.loc?.join('.') || 'field'}: ${item.msg}`).join('\n');
        alert(`Validation Error:\n${msg}`);
      } else {
        alert(`Status ${err.response?.status || 'Error'}: Account may already exist or backend issue.`);
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    setToken("");
    setTasks([]);
  };

  const fetchTasks = async () => {
    try {
      const res = await axios.get(`${API_BASE}/notifications/`, authHeader);
      let extractedTasks = [];
      if (Array.isArray(res.data)) {
        extractedTasks = res.data;
      } else if (res.data && typeof res.data === 'object') {
        extractedTasks = res.data.notifications || res.data.tasks || res.data.data || [];
      }
      setTasks(extractedTasks);
    } catch (err) {
      console.error("Fetch tasks error:", err);
    }
  };

  const fetchAiCoach = async () => {
    try {
      const res = await axios.get(`${API_BASE}/users/me/ai-coach`, authHeader);
      setAiTip(res.data.tip || res.data.message || res.data.ai_coach_insights || "");
    } catch (err) {
      console.error("Fetch AI coach error:", err);
    }
  };

  const fetchInsights = async () => {
    try {
      const res = await axios.get(`${API_BASE}/users/me/recommendations`, authHeader);
      setInsights(res.data.recommendation || res.data.message || res.data.recommendations || "");
    } catch (err) {
      console.error("Fetch insights error:", err);
    }
  };

  const handleScheduleTask = async (e) => {
    e.preventDefault();
    if (!taskName || !startTime || !endTime) {
      alert("Please fill all task fields");
      return;
    }

    const startIso = new Date(startTime).toISOString();
    const endIso = new Date(endTime).toISOString();

    try {
      await axios.post(
        `${API_BASE}/tasks/`,
        null,
        {
          params: {
            title: taskName,
            scheduled_time: startIso,
            expected_end_time: endIso,
          },
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      alert("Task Scheduled Successfully! 🎉");
      resetTaskForm();
    } catch (err) {
      console.error("Schedule error:", err);
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        alert(`Backend Error: ${detail}`);
      } else if (Array.isArray(detail)) {
        const msg = detail.map((item) => `${item.loc?.join('.') || 'field'}: ${item.msg}`).join('\n');
        alert(`Validation Error:\n${msg}`);
      } else {
        alert(`Error Status ${err.response?.status || 'Unknown'}`);
      }
    }
  };

  const resetTaskForm = () => {
    setTaskName("");
    setStartTime("");
    setEndTime("");
    fetchTasks();
    fetchAiCoach();
    fetchInsights();
  };

  const applyPreset = (preset) => {
    const now = new Date();
    const end = new Date(now.getTime() + preset.durationMin * 60000);

    const formatLocal = (d) => {
      const pad = (n) => (n < 10 ? '0' + n : n);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    setTaskName(preset.name);
    setStartTime(formatLocal(now));
    setEndTime(formatLocal(end));
  };

  const toggleTaskComplete = async (taskId) => {
    try {
      await axios.put(
        `${API_BASE}/tasks/${taskId}/respond`,
        null,
        {
          params: { user_response: "completed" },
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      fetchTasks();
      fetchAiCoach();
      fetchInsights();
    } catch (err) {
      alert("Failed to update task status");
    }
  };

  if (!token) {
    return (
      <div style={styles.authContainer}>
        <div style={styles.authCard}>
          <h2 style={{ marginBottom: "20px" }}>{isSignUp ? "Create Account" : "Welcome Back"}</h2>
          <form onSubmit={handleAuth} style={styles.form}>
            <input
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={styles.input}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={styles.input}
            />
            <button type="submit" style={styles.btnPrimary}>
              {isSignUp ? "Sign Up" : "Log In"}
            </button>
          </form>
          <p
            onClick={() => setIsSignUp(!isSignUp)}
            style={{ marginTop: "15px", cursor: "pointer", color: "#38bdf8" }}
          >
            {isSignUp ? "Already have an account? Log In" : "Don't have an account? Sign Up"}
          </p>
        </div>
      </div>
    );
  }

  const activeTasks = tasks.filter((t) => {
    const s = (t.status || t.state || t.user_response || "").toLowerCase();
    return s !== "completed" && s !== "done";
  });

  const completedTasks = tasks.filter((t) => {
    const s = (t.status || t.state || t.user_response || "").toLowerCase();
    return s === "completed" || s === "done";
  });

  return (
    <div style={styles.appContainer}>
      <header style={styles.header}>
        <h1 style={{ fontSize: "1.5rem" }}>⚡ AI Daily Life OS</h1>
        <div>
          <button
            onClick={() => setActiveTab("schedule")}
            style={{
              ...styles.tabBtn,
              backgroundColor: activeTab === "schedule" ? "#0284c7" : "transparent",
            }}
          >
            Dashboard & Tasks
          </button>
          <button
            onClick={() => setActiveTab("history")}
            style={{
              ...styles.tabBtn,
              backgroundColor: activeTab === "history" ? "#0284c7" : "transparent",
            }}
          >
            History & Record ({completedTasks.length})
          </button>
          <button onClick={handleLogout} style={styles.btnLogout}>
            Logout
          </button>
        </div>
      </header>

      {activeTab === "schedule" ? (
        <main style={styles.main}>
          <section style={styles.card}>
            <h3>🚀 Quick Routine Presets</h3>
            <p style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: "10px" }}>
              Click to quick fill common routine tasks:
            </p>
            <div style={styles.presetGrid}>
              {presets.map((p, idx) => (
                <button key={idx} onClick={() => applyPreset(p)} style={styles.presetBtn}>
                  + {p.name}
                </button>
              ))}
            </div>
          </section>

          <section style={styles.card}>
            <h3>➕ Schedule New Task</h3>
            <form onSubmit={handleScheduleTask} style={styles.form}>
              <input
                type="text"
                placeholder="Task Name (e.g., Coding, Exercise, Reading)"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                style={styles.input}
              />
              <div style={styles.row}>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>Start Time</label>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>Expected End Time</label>
                  <input
                    type="datetime-local"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    style={styles.input}
                  />
                </div>
              </div>
              <button type="submit" style={styles.btnPrimary}>
                Schedule Task
              </button>
            </form>
          </section>

          <section style={styles.card}>
            <h3>📋 Scheduled Active Tasks ({tasks.length > 0 ? activeTasks.length : 0})</h3>
            {tasks.length === 0 || activeTasks.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>No active tasks scheduled right now.</p>
            ) : (
              <div style={styles.taskList}>
                {activeTasks.map((t, idx) => (
                  <div key={t.id || t.task_id || idx} style={styles.taskCard}>
                    <div>
                      <strong style={{ fontSize: "1.1rem" }}>
                        {t.title || t.task_name || t.message || "Scheduled Task"}
                      </strong>
                      <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "4px 0" }}>
                        🕒 {t.scheduled_time || t.start_time ? new Date(t.scheduled_time || t.start_time).toLocaleString() : "Scheduled"}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleTaskComplete(t.id || t.task_id)}
                      style={styles.btnComplete}
                    >
                      Mark Complete ✓
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={{ ...styles.card, borderLeft: "4px solid #38bdf8" }}>
            <h3>🤖 Generative AI Life Coach</h3>
            <p style={{ fontStyle: "italic", marginTop: "8px" }}>
              "{aiTip || "Tasks complete kijiye, phir main aapki habits analyze karke tips dunga!"}"
            </p>
          </section>

          <section style={{ ...styles.card, borderLeft: "4px solid #a855f7" }}>
            <h3>🧠 Adaptive Behavioral Insights</h3>
            <p style={{ marginTop: "8px" }}>
              {insights || "Abhi enough data nahi hai. 2-3 tasks complete karke record dekhiye!"}
            </p>
          </section>
        </main>
      ) : (
        <main style={styles.main}>
          <section style={styles.card}>
            <h3>📊 Completed Routine Record & History</h3>
            {completedTasks.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>No completed tasks recorded yet.</p>
            ) : (
              <div style={styles.taskList}>
                {completedTasks.map((t, idx) => (
                  <div key={t.id || t.task_id || idx} style={{ ...styles.taskCard, opacity: 0.85 }}>
                    <div>
                      <strong style={{ textDecoration: "line-through", fontSize: "1.1rem" }}>
                        {t.title || t.task_name || t.message || "Completed Task"}
                      </strong>
                      <p style={{ fontSize: "0.8rem", color: "#34d399", margin: "4px 0" }}>
                        ✓ Completed
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}

const styles = {
  appContainer: { minHeight: "100vh", backgroundColor: "#0f172a", color: "#f8fafc", fontFamily: "'Segoe UI', Roboto, sans-serif" },
  authContainer: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a", color: "#f8fafc" },
  authCard: { backgroundColor: "#1e293b", padding: "30px", borderRadius: "12px", width: "100%", maxWidth: "400px", textAlign: "center", boxShadow: "0 10px 25px rgba(0,0,0,0.5)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 30px", backgroundColor: "#1e293b", borderBottom: "1px solid #334155", flexWrap: "wrap", gap: "10px" },
  tabBtn: { color: "#fff", border: "none", padding: "8px 14px", borderRadius: "6px", cursor: "pointer", marginRight: "8px" },
  btnLogout: { backgroundColor: "#ef4444", color: "#fff", border: "none", padding: "8px 14px", borderRadius: "6px", cursor: "pointer" },
  main: { maxWidth: "800px", margin: "30px auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: "20px" },
  card: { backgroundColor: "#1e293b", padding: "20px", borderRadius: "10px", boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)" },
  presetGrid: { display: "flex", gap: "10px", flexWrap: "wrap" },
  presetBtn: { backgroundColor: "#334155", color: "#38bdf8", border: "1px solid #0284c7", padding: "8px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem" },
  form: { display: "flex", flexDirection: "column", gap: "12px", marginTop: "10px" },
  row: { display: "flex", gap: "10px", flexWrap: "wrap" },
  label: { display: "block", fontSize: "0.8rem", color: "#94a3b8", marginBottom: "4px" },
  input: { width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #334155", backgroundColor: "#0f172a", color: "#fff", boxSizing: "border-box" },
  btnPrimary: { backgroundColor: "#0284c7", color: "#fff", border: "none", padding: "12px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" },
  taskList: { display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" },
  taskCard: { display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#0f172a", padding: "12px 16px", borderRadius: "8px", border: "1px solid #334155" },
  btnComplete: { backgroundColor: "#10b981", color: "#fff", border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer" },
};

export default App;