import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = "https://ai-daily-backend-ldjh.onrender.com";

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [tasks, setTasks] = useState([]);
  const [notifiedTasks, setNotifiedTasks] = useState(new Set()); // Notification duplicate rokne ke liye
  const [activeTab, setActiveTab] = useState("schedule");

  useEffect(() => {
    if (token) {
      fetchTasks();
      // Browser Notification Permission maango
      if ("Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission();
      }
    }
  }, [token]);

  // Real-time Timer: Har 30 second me check karega
  useEffect(() => {
    const interval = setInterval(() => {
      tasks.forEach(t => {
        const now = new Date();
        const startTime = new Date(t.scheduled_time || t.start_time);
        const diff = (startTime - now) / 1000 / 60; // Minutes remaining

        // Agar 0 se 2 minute ke beech hai aur pehle notify nahi kiya
        if (diff > -1 && diff < 2 && !notifiedTasks.has(t.id || t.notification_id)) {
          triggerNotification(t);
        }
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [tasks, notifiedTasks]);

  const triggerNotification = (t) => {
    if (Notification.permission === "granted") {
      new Notification("Task Reminder! ⚡", {
        body: `Abhi ${t.title || t.task_name} shuru karne ka time ho gaya hai!`,
      });
      setNotifiedTasks(prev => new Set(prev).add(t.id || t.notification_id));
    }
  };

  // ... [Keep Auth and API functions same as previous version] ...
  const fetchTasks = async () => {
    try {
      const res = await axios.get(`${API_BASE}/notifications/`, { headers: { Authorization: `Bearer ${token}` } });
      let extracted = Array.isArray(res.data) ? res.data : (res.data.notifications || []);
      setTasks(extracted);
    } catch (err) { console.error(err); }
  };

  const handleScheduleTask = async (taskName, startTime, endTime) => {
    try {
      const res = await axios.post(`${API_BASE}/tasks/`, null, {
        params: { title: taskName, scheduled_time: new Date(startTime).toISOString(), expected_end_time: new Date(endTime).toISOString() },
        headers: { Authorization: `Bearer ${token}` },
      });
      alert("Task Scheduled! Notification set. ✅");
      fetchTasks();
    } catch (err) { alert("Error scheduling task."); }
  };

  const toggleTaskComplete = async (item) => {
    const targetId = item.notification_id || item.task_id || item.id;
    try {
      await axios.put(`${API_BASE}/tasks/${targetId}/respond`, null, {
        params: { user_response: "completed" },
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchTasks();
    } catch (err) { alert("Marked locally."); setTasks(prev => prev.filter(t => (t.id || t.task_id) !== targetId)); }
  };

  // UI rendering (With upgraded Task Cards)
  return (
    <div style={styles.appContainer}>
        {/* Header and Auth logic same as before... */}
        {/* Render Active Tasks with new Card Style */}
        <div style={styles.taskList}>
            {tasks.filter(t => t.status !== 'completed').map((t, i) => (
                <div key={i} style={styles.taskCard}>
                    <div>
                        <strong style={{fontSize: '1.2rem'}}>{t.title || "Task"}</strong>
                        <p style={{fontSize: '0.85rem', color: '#38bdf8'}}>
                            Start: {new Date(t.scheduled_time).toLocaleTimeString()} 
                            <br/>
                            End: {new Date(t.expected_end_time).toLocaleTimeString()}
                        </p>
                    </div>
                    <button onClick={() => toggleTaskComplete(t)} style={styles.btnComplete}>Complete ✓</button>
                </div>
            ))}
        </div>
    </div>
  );
}

// Styles add kar lena... (Previous version wale hi hain)
const styles = { 
    taskCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e293b', padding: '15px', borderRadius: '10px', margin: '10px 0' },
    btnComplete: { backgroundColor: '#10b981', color: 'white', border: 'none', padding: '10px', borderRadius: '5px' },
    appContainer: { backgroundColor: '#0f172a', color: 'white', minHeight: '100vh', padding: '20px' }
};

export default App;