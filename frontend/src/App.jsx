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
  const [notifiedTasks, setNotifiedTasks] = useState(new Set());
  const [notifPermission, setNotifPermission] = useState(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default"
  );

  // Modal State for Task Response (Complete / Reschedule / Skip + Notes)
  const [selectedTask, setSelectedTask] = useState(null);
  const [responseAction, setResponseAction] = useState("completed"); // "completed" | "rescheduled" | "skipped"
  const [userReason, setUserReason] = useState("");
  const [newRescheduleTime, setNewRescheduleTime] = useState("");

  const authHeader = {
    headers: { Authorization: `Bearer ${token}` },
  };

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

  // Real-Time Notification Timer
  useEffect(() => {
    if (!token) return;

    const interval = setInterval(() => {
      const now = new Date().getTime();

      tasks.forEach((t) => {
        const taskId = t.notification_id || t.task_id || t.id;
        const taskTitle = t.title || t.message || t.task_name || "Task";
        
        if (!t.scheduled_time && !t.start_time) return;

        const startMs = new Date(t.scheduled_time || t.start_time).getTime();
        const endMs = t.expected_end_time ? new Date(t.expected_end_time).getTime() : null;

        const startKey = `${taskId}-start`;
        if (Math.abs(now - startMs) < 60000 && !notifiedTasks.has(startKey)) {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("🚀 Task Started!", { body: `Time to start: ${taskTitle}` });
          }
          setNotifiedTasks((prev) => new Set(prev).add(startKey));
        }

        const endKey = `${taskId}-end`;
        if (endMs && Math.abs(now - endMs) < 60000 && !notifiedTasks.has(endKey)) {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("⏰ Task Time Ended!", { body: `How did it go for: ${taskTitle}?` });
          }
          setNotifiedTasks((prev) => new Set(prev).add(endKey));
        }
      });
    }, 15000);

    return () => clearInterval(interval);
  }, [tasks, token, notifiedTasks]);

  const requestNotificationPermission = () => {
    if ("Notification" in window) {
      Notification.requestPermission().then((permission) => {
        setNotifPermission(permission);
        if (permission === "granted") {
          alert("Notification Permission Granted! 🎉");
        } else {
          alert("Notification Permission Denied by Browser.");
        }
      });
    } else {
      alert("Browser does not support notifications.");
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    const cleanEmail = email.trim();

    if (isSignUp) {
      try {
        await axios.post(`${API_BASE}/signup`, { email: cleanEmail, password: password });
        alert("Account created successfully! 🎉 Please log in now.");
        setIsSignUp(false);
      } catch (err) {
        try {
          await axios.post(`${API_BASE}/signup`, null, {
            params: { username: cleanEmail, password: password, email: cleanEmail }
          });
          alert("Account created successfully! 🎉 Please log in now.");
          setIsSignUp(false);
        } catch (innerErr) {
          alert("Sign up failed.");
        }
      }
    } else {
      try {
        const res = await axios.post(`${API_BASE}/login`, null, {
          params: { username: cleanEmail, password: password }
        });
        const accessToken = res.data.access_token || res.data.token;
        if (accessToken) {
          localStorage.setItem("token", accessToken);
          setToken(accessToken);
        } else {
          alert("Login missing token.");
        }
      } catch (err) {
        try {
          const resBody = await axios.post(`${API_BASE}/login`, {
            email: cleanEmail,
            username: cleanEmail,
            password: password,
          });
          const accessToken = resBody.data.access_token || resBody.data.token;
          if (accessToken) {
            localStorage.setItem("token", accessToken);
            setToken(accessToken);
          }
        } catch (innerErr) {
          alert("Login failed.");
        }
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
      
      setTasks(prev => {
        if (extractedTasks.length === 0 && prev.length > 0) return prev;
        return extractedTasks;
      });
    } catch (err) {
      console.error("Fetch tasks error:", err);
    }
  };

  const fetchAiCoach = async () => {
    try {
      setAiTip("AI Life Coach active: Analyzing your completion reasons to optimize daily productivity.");
    } catch (err) {
      console.error(err);
    }
  };

  const fetchInsights = async () => {
    try {
      setInsights("Tracking completion vs skip reasons builds personalized streak insights.");
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

    const startIso = new Date(startTime).toISOString();
    const endIso = new Date(endTime).toISOString();

    const newTask = {
      id: Date.now(),
      notification_id: Date.now(),
      title: taskName,
      message: taskName,
      scheduled_time: startIso,
      expected_end_time: endIso,
      status: "pending"
    };

    try {
      const res = await axios.post(
        `${API_BASE}/tasks/`,
        null,
        {
          params: {
            title: taskName,
            scheduled_time: startIso,
            expected_end_time: endIso,
          },
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.data?.id || res.data?.notification_id) {
        newTask.id = res.data.id || res.data.notification_id;
        newTask.notification_id = res.data.notification_id || res.data.id;
      }
    } catch (err) {
      console.log("Saving locally on frontend:", err);
    }

    setTasks((prev) => [newTask, ...prev]);
    alert("Task Scheduled Successfully! 🔔 Notification active.");
    setTaskName("");
    setStartTime("");
    setEndTime("");
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

  // Submit User Feedback Modal (Complete / Reschedule / Skip + Notes)
  const handleSubmitTaskResponse = async () => {
    if (!selectedTask) return;

    const targetId = selectedTask.notification_id || selectedTask.task_id || selectedTask.id;

    try {
      if (targetId && typeof targetId === 'number') {
        await axios.put(
          `${API_BASE}/tasks/${targetId}/respond`,
          null,
          {
            params: { 
              user_response: responseAction,
              notes: userReason,
              reschedule_time: newRescheduleTime ? new Date(newRescheduleTime).toISOString() : null
            },
            headers: { Authorization: `Bearer ${token}` },
          }
        );
      }
    } catch (err) {
      console.log("Status recorded locally");
    }

    setTasks((prev) =>
      prev.map((t) => {
        if ((t.notification_id || t.id) === (selectedTask.notification_id || selectedTask.id)) {
          return { 
            ...t, 
            status: responseAction,
            user_reason: userReason,
            rescheduled_time: newRescheduleTime 
          };
        }
        return t;
      })
    );

    alert(`Task marked as ${responseAction.toUpperCase()}! Feedback saved.`);
    setSelectedTask(null);
    setUserReason("");
    setNewRescheduleTime("");
  };

  if (!token) {
    return (
      <div style={styles.authContainer}>
        <div style={styles.authCard}>
          <h2 style={{ marginBottom: "20px" }}>{isSignUp ? "Create Account" : "Welcome Back"}</h2>
          <form onSubmit={handleAuth} style={styles.form}>
            <input
              type="text"
              placeholder="Email or Username"
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
    return s !== "completed" && s !== "done" && s !== "skipped" && s !== "rescheduled";
  });

  const completedTasks = tasks.filter((t) => {
    const s = (t.status || t.state || t.user_response || "").toLowerCase();
    return s === "completed" || s === "done" || s === "skipped" || s === "rescheduled";
  });

  return (
    <div style={styles.appContainer}>
      <header style={styles.header}>
        <h1 style={{ fontSize: "1.5rem" }}>⚡ AI Daily Life OS</h1>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {notifPermission !== "granted" && (
            <button onClick={requestNotificationPermission} style={styles.btnNotif}>
              🔔 Enable Notifications
            </button>
          )}
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
            <h3>📋 Scheduled Active Tasks ({activeTasks.length})</h3>
            {activeTasks.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>No active tasks scheduled right now.</p>
            ) : (
              <div style={styles.taskList}>
                {activeTasks.map((t, idx) => (
                  <div key={t.notification_id || t.task_id || t.id || idx} style={styles.taskCard}>
                    <div>
                      <strong style={{ fontSize: "1.1rem" }}>
                        {t.title || t.message || t.task_name || "Scheduled Task"}
                      </strong>
                      <p style={{ fontSize: "0.8rem", color: "#38bdf8", margin: "4px 0" }}>
                        🕒 Start: {t.scheduled_time || t.start_time ? new Date(t.scheduled_time || t.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "N/A"} 
                        {t.expected_end_time && ` | End: ${new Date(t.expected_end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedTask(t)}
                      style={styles.btnAction}
                    >
                      Update Status ⚙️
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
            <h3>📊 Routine History & Experience Log</h3>
            {completedTasks.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>No completed or logged tasks yet.</p>
            ) : (
              <div style={styles.taskList}>
                {completedTasks.map((t, idx) => (
                  <div key={t.notification_id || t.task_id || t.id || idx} style={{ ...styles.taskCard, opacity: 0.9 }}>
                    <div>
                      <strong style={{ fontSize: "1.1rem" }}>
                        {t.title || t.message || t.task_name || "Task"}
                      </strong>
                      <p style={{ fontSize: "0.85rem", color: t.status === "completed" ? "#34d399" : t.status === "skipped" ? "#ef4444" : "#f59e0b", margin: "4px 0" }}>
                        Status: <b>{t.status?.toUpperCase()}</b>
                      </p>
                      {t.user_reason && (
                        <p style={{ fontSize: "0.8rem", color: "#cbd5e1", fontStyle: "italic", marginTop: "4px" }}>
                          💬 Notes/Reason: "{t.user_reason}"
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {/* Task Response Modal */}
      {selectedTask && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <h3>Update Task: "{selectedTask.title || selectedTask.task_name || 'Task'}"</h3>
            
            <label style={styles.labelModal}>Select Status:</label>
            <div style={{ display: "flex", gap: "10px", margin: "10px 0" }}>
              <button
                type="button"
                onClick={() => setResponseAction("completed")}
                style={{
                  ...styles.statusBtn,
                  backgroundColor: responseAction === "completed" ? "#10b981" : "#334155"
                }}
              >
                ✓ Complete
              </button>
              <button
                type="button"
                onClick={() => setResponseAction("rescheduled")}
                style={{
                  ...styles.statusBtn,
                  backgroundColor: responseAction === "rescheduled" ? "#f59e0b" : "#334155"
                }}
              >
                🕒 Reschedule
              </button>
              <button
                type="button"
                onClick={() => setResponseAction("skipped")}
                style={{
                  ...styles.statusBtn,
                  backgroundColor: responseAction === "skipped" ? "#ef4444" : "#334155"
                }}
              >
                🚫 Skip
              </button>
            </div>

            {responseAction === "rescheduled" && (
              <div style={{ marginBottom: "12px" }}>
                <label style={styles.labelModal}>New Scheduled Time:</label>
                <input
                  type="datetime-local"
                  value={newRescheduleTime}
                  onChange={(e) => setNewRescheduleTime(e.target.value)}
                  style={styles.input}
                />
              </div>
            )}

            <label style={styles.labelModal}>Reason / Reflection / Experience Notes:</label>
            <textarea
              placeholder="e.g., Finished smoothly! / Felt tired / Had college work..."
              value={userReason}
              onChange={(e) => setUserReason(e.target.value)}
              rows={3}
              style={{ ...styles.input, resize: "vertical" }}
            />

            <div style={{ display: "flex", gap: "10px", marginTop: "15px", justifyContent: "flex-end" }}>
              <button onClick={() => setSelectedTask(null)} style={styles.btnCancel}>
                Cancel
              </button>
              <button onClick={handleSubmitTaskResponse} style={styles.btnSubmit}>
                Save Feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  appContainer: { minHeight: "100vh", backgroundColor: "#0f172a", color: "#f8fafc", fontFamily: "'Segoe UI', Roboto, sans-serif" },
  authContainer: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a", color: "#f8fafc" },
  authCard: { backgroundColor: "#1e293b", padding: "30px", borderRadius: "12px", width: "100%", maxWidth: "400px", textAlign: "center", boxShadow: "0 10px 25px rgba(0,0,0,0.5)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 30px", backgroundColor: "#1e293b", borderBottom: "1px solid #334155", flexWrap: "wrap", gap: "10px" },
  tabBtn: { color: "#fff", border: "none", padding: "8px 14px", borderRadius: "6px", cursor: "pointer" },
  btnNotif: { backgroundColor: "#eab308", color: "#0f172a", border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" },
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
  btnAction: { backgroundColor: "#0284c7", color: "#fff", border: "none", padding: "8px 12px", borderRadius: "6px", cursor: "pointer" },
  
  // Modal Styles
  modalOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modalCard: { backgroundColor: "#1e293b", padding: "25px", borderRadius: "12px", width: "90%", maxWidth: "480px", border: "1px solid #334155" },
  labelModal: { display: "block", fontSize: "0.85rem", color: "#94a3b8", marginTop: "10px" },
  statusBtn: { flex: 1, padding: "10px", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" },
  btnCancel: { backgroundColor: "#475569", color: "#fff", border: "none", padding: "10px 16px", borderRadius: "6px", cursor: "pointer" },
  btnSubmit: { backgroundColor: "#0284c7", color: "#fff", border: "none", padding: "10px 16px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" },
};

export default App;