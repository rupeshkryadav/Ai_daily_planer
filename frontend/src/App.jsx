import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = "https://ai-daily-backend-ldjh.onrender.com";

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [aiTip, setAiTip] = useState("");
  const [insights, setInsights] = useState("");
  const [activeTab, setActiveTab] = useState("schedule");

  // Routine Presets
  const presets = [
    { name: "Morning Workout & Exercise", durationMin: 45 },
    { name: "Focused Coding & Dev Block", durationMin: 120 },
    { name: "Reading & Learning Slot", durationMin: 30 },
    { name: "Night Review & Planning", durationMin: 20 },
  ];

  useEffect(() => {
    if (token) {
      // Fetch initial data
      fetchTasks();
      fetchAiCoach();
      fetchInsights();
    }
  }, [token]);

  const handleAuth = async (e) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    try {
      const res = await axios.post(`${API_BASE}/login`, null, {
        params: { username: cleanEmail, password: password }
      });
      const accessToken = res.data.access_token || res.data.token;
      localStorage.setItem("token", accessToken);
      setToken(accessToken);
    } catch (err) {
      alert("Login Failed. Check console for details.");
      console.error(err);
    }
  };

  const fetchTasks = async () => {
    console.log("--- DEBUG: Fetching Notifications ---");
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const res = await axios.get(`${API_BASE}/notifications/`, { headers });
      
      console.log("DEBUG: Response Status:", res.status);
      console.log("DEBUG: Full API Response:", res.data); // Yahan sab dikhega
      
      let rawTasks = [];
      if (Array.isArray(res.data)) {
        rawTasks = res.data;
      } else if (res.data && typeof res.data === 'object') {
        // Checking for common keys
        rawTasks = res.data.notifications || res.data.tasks || res.data.data || [];
      }
      
      console.log("DEBUG: Parsed Tasks:", rawTasks);
      setTasks(rawTasks);
    } catch (err) {
      console.error("DEBUG: Fetch notifications failed:", err.response || err);
    }
  };

  const fetchAiCoach = async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const res = await axios.get(`${API_BASE}/users/me/ai-coach`, { headers });
      setAiTip(res.data.tip || res.data.message || "");
    } catch (err) { console.error(err); }
  };

  const fetchInsights = async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const res = await axios.get(`${API_BASE}/users/me/recommendations`, { headers });
      setInsights(res.data.recommendation || res.data.message || "");
    } catch (err) { console.error(err); }
  };

  const handleScheduleTask = async (e) => {
    e.preventDefault();
    try {
      const startIso = new Date(startTime).toISOString();
      const endIso = new Date(endTime).toISOString();
      
      await axios.post(`${API_BASE}/tasks/`, null, {
        params: { title: taskName, scheduled_time: startIso, expected_end_time: endIso },
        headers: { Authorization: `Bearer ${token}` },
      });
      
      alert("Task scheduled! Refreshing list...");
      // Auto-refresh with delay to allow backend to process
      setTimeout(fetchTasks, 2000); 
    } catch (err) {
      alert("Scheduling failed. Check console.");
      console.error(err);
    }
  };

  return (
    <div style={styles.container}>
      {!token ? (
        <div style={styles.card}>
          <h2>Log In</h2>
          <input type="text" placeholder="Email" onChange={(e) => setEmail(e.target.value)} style={styles.input} />
          <input type="password" placeholder="Password" onChange={(e) => setPassword(e.target.value)} style={styles.input} />
          <button onClick={handleAuth} style={styles.btn}>Log In</button>
        </div>
      ) : (
        <div style={styles.main}>
          <button onClick={fetchTasks} style={styles.btn}>🔄 Manual Refresh</button>
          <section style={styles.card}>
            <h3>Schedule Task</h3>
            <input type="text" placeholder="Task Name" onChange={(e) => setTaskName(e.target.value)} style={styles.input} />
            <input type="datetime-local" onChange={(e) => setStartTime(e.target.value)} style={styles.input} />
            <input type="datetime-local" onChange={(e) => setEndTime(e.target.value)} style={styles.input} />
            <button onClick={handleScheduleTask} style={styles.btn}>Schedule</button>
          </section>
          
          <section style={styles.card}>
            <h3>Active Tasks ({tasks.length})</h3>
            {tasks.map((t, i) => (
              <div key={i} style={styles.taskItem}>
                {t.title || t.message || "Unnamed Task"}
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { backgroundColor: "#0f172a", minHeight: "100vh", color: "white", padding: "20px" },
  card: { backgroundColor: "#1e293b", padding: "20px", borderRadius: "8px", maxWidth: "400px", margin: "auto" },
  input: { width: "100%", padding: "10px", margin: "5px 0", borderRadius: "4px" },
  btn: { padding: "10px", backgroundColor: "#0284c7", color: "white", border: "none", cursor: "pointer" },
  taskItem: { padding: "10px", borderBottom: "1px solid #334155" },
  main: { maxWidth: "800px", margin: "auto" }
};

export default App;