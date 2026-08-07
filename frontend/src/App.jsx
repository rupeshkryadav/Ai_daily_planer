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
  const [activeTab, setActiveTab] = useState("schedule"); // 'schedule' or 'history'

  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

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
      const res = await axios.post(`${API_BASE}${endpoint}`, { email, password });
      if (isSignUp) {
        alert("Account created! Please log in.");
        setIsSignUp(false);
      } else {
        localStorage.setItem("token", res.data.access_token);
        setToken(res.data.access_token);
      }
    } catch (err) {
      alert(err.response?.data?.detail || "Authentication Failed");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    setToken("");
  };

  const fetchTasks = async () => {
    try {
      const res = await axios.get(`${API_BASE}/tasks`, authHeader);
      setTasks(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAiCoach = async () => {
    try {
      const res = await axios.get(`${API_BASE}/ai-coach`, authHeader);
      setAiTip(res.data.tip || res.data.message || "");
    } catch (err) {
      console.error(err);
    }
  };

  const fetchInsights = async () => {
    try {
      const res = await axios.get(`${API_BASE}/behavioral-insights`, authHeader);
      setInsights(res.data.insight || res.data.message || "");
    } catch (err) {
      console.error(err);
    }
  };

  const handleScheduleTask = async (e) => {
    e.preventDefault();
    if (!taskName || !startTime || !endTime) {
      alert("Please fill all task fields");
      return;
    }
    try {
      await axios.post(
        `${API_BASE}/schedule-task`,
        {
          task_name: taskName,
          start_time: new Date(startTime).toISOString(),
          expected_end_time: new Date(endTime).toISOString(),
        },
        authHeader
      );
      setTaskName("");
      setStartTime("");
      setEndTime("");
      fetchTasks();
      fetchAiCoach();
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to schedule task");
    }
  };

  const applyPreset = (preset) => {
    const now = new Date();
    const end = new Date(now.getTime() + preset.durationMin * 60000);
    
    // Format to YYYY-MM-DDTHH:MM for datetime-local input
    const formatLocal = (d) => {
      const pad = (n) => (n < 10 ? '0' + n : n);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    setTaskName(preset.name);
    setStartTime(formatLocal(now));
    setEndTime(formatLocal(end));
  };

  const toggleTaskComplete = async (taskId, currentStatus) => {
    try {
      await axios.patch(
        `${API_BASE}/tasks/${taskId}`,
        { status: currentStatus === "Completed" ? "Pending" : "Completed" },
        authHeader
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

  const activeTasks = tasks.filter((t) => t.status !== "Completed");
  const completedTasks = tasks.filter((t) => t.status === "Completed");

  return (
    <div style={styles.appContainer}>
      {/* Header */}
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
          {/* Preset Buttons */}
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

          {/* Schedule Form */}
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

          {/* Active Tasks Record */}
          <section style={styles.card}>
            <h3>📋 Scheduled Active Tasks ({activeTasks.length})</h3>
            {activeTasks.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>No active tasks scheduled right now.</p>
            ) : (
              <div style={styles.taskList}>
                {activeTasks.map((t) => (
                  <div key={t.id} style={styles.taskCard}>
                    <div>
                      <strong style={{ fontSize: "1.1rem" }}>{t.task_name}</strong>
                      <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "4px 0" }}>
                        🕒 {new Date(t.start_time).toLocaleString()} - {new Date(t.expected_end_time).toLocaleTimeString()}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleTaskComplete(t.id, t.status)}
                      style={styles.btnComplete}
                    >
                      Mark Complete ✓
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* AI Coach Card */}
          <section style={{ ...styles.card, borderLeft: "4px solid #38bdf8" }}>
            <h3>🤖 Generative AI Life Coach</h3>
            <p style={{ fontStyle: "italic", marginTop: "8px" }}>
              "{aiTip || "Tasks complete kijiye, phir main aapki habits analyze karke tips dunga!"}"
            </p>
          </section>

          {/* Behavioral Insights */}
          <section style={{ ...styles.card, borderLeft: "4px solid #a855f7" }}>
            <h3>🧠 Adaptive Behavioral Insights</h3>
            <p style={{ marginTop: "8px" }}>
              {insights || "Abhi enough data nahi hai. 2-3 tasks complete karke record dekhiye!"}
            </p>
          </section>
        </main>
      ) : (
        /* History Tab */
        <main style={styles.main}>
          <section style={styles.card}>
            <h3>📊 Completed Routine Record & History</h3>
            {completedTasks.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>No completed tasks recorded yet.</p>
            ) : (
              <div style={styles.taskList}>
                {completedTasks.map((t) => (
                  <div key={t.id} style={{ ...styles.taskCard, opacity: 0.85 }}>
                    <div>
                      <strong style={{ textDecoration: "line-through", fontSize: "1.1rem" }}>
                        {t.task_name}
                      </strong>
                      <p style={{ fontSize: "0.8rem", color: "#34d399", margin: "4px 0" }}>
                        ✓ Completed on {new Date(t.start_time).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleTaskComplete(t.id, t.status)}
                      style={styles.btnUndo}
                    >
                      Undo ↩
                    </button>
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
  appContainer: {
    minHeight: "100vh",
    backgroundColor: "#0f172a",
    color: "#f8fafc",
    fontFamily: "'Segoe UI', Roboto, sans-serif",
  },
  authContainer: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
    color: "#f8fafc",
  },
  authCard: {
    backgroundColor: "#1e293b",
    padding: "30px",
    borderRadius: "12px",
    width: "100%",
    maxWidth: "400px",
    textAlign: "center",
    boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "15px 30px",
    backgroundColor: "#1e293b",
    borderBottom: "1px solid #334155",
    flexWrap: "wrap",
    gap: "10px",
  },
  tabBtn: {
    color: "#fff",
    border: "none",
    padding: "8px 14px",
    borderRadius: "6px",
    cursor: "pointer",
    marginRight: "8px",
  },
  btnLogout: {
    backgroundColor: "#ef4444",
    color: "#fff",
    border: "none",
    padding: "8px 14px",
    borderRadius: "6px",
    cursor: "pointer",
  },
  main: {
    maxWidth: "800px",
    margin: "30px auto",
    padding: "0 20px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  card: {
    backgroundColor: "#1e293b",
    padding: "20px",
    borderRadius: "10px",
    boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
  },
  presetGrid: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },
  presetBtn: {
    backgroundColor: "#334155",
    color: "#38bdf8",
    border: "1px solid #0284c7",
    padding: "8px 12px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "0.85rem",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    marginTop: "10px",
  },
  row: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },
  label: {
    display: "block",
    fontSize: "0.8rem",
    color: "#94a3b8",
    marginBottom: "4px",
  },
  input: {
    width: "100%",
    padding: "10px",
    borderRadius: "6px",
    border: "1px solid #334155",
    backgroundColor: "#0f172a",
    color: "#fff",
    boxSizing: "border-box",
  },
  btnPrimary: {
    backgroundColor: "#0284c7",
    color: "#fff",
    border: "none",
    padding: "12px",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "bold",
  },
  taskList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    marginTop: "10px",
  },
  taskCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#0f172a",
    padding: "12px 16px",
    borderRadius: "8px",
    border: "1px solid #334155",
  },
  btnComplete: {
    backgroundColor: "#10b981",
    color: "#fff",
    border: "none",
    padding: "8px 12px",
    borderRadius: "6px",
    cursor: "pointer",
  },
  btnUndo: {
    backgroundColor: "#64748b",
    color: "#fff",
    border: "none",
    padding: "6px 10px",
    borderRadius: "6px",
    cursor: "pointer",
  },
};

export default App;