import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { LocalNotifications } from "@capacitor/local-notifications";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const storageKey = (userId) => `ai_daily_tasks_${userId}`;
const dateTimeLocal = (value) => {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const displayDate = (value) => new Date(value).toLocaleString([], {
  weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [page, setPage] = useState("dashboard");
  const [form, setForm] = useState({ title: "", start: "", end: "" });
  const [selectedTask, setSelectedTask] = useState(null);
  const [response, setResponse] = useState("completed");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [notes, setNotes] = useState("");
  const [coach, setCoach] = useState("");
  const [insight, setInsight] = useState("");
  const [muted, setMuted] = useState(() => localStorage.getItem("ai_app_muted") === "true");
  const [notice, setNotice] = useState("");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [profileForm, setProfileForm] = useState({ name: "", date_of_birth: "", gender: "", use_case: "student", study_hours: "", work_hours: "", sleep_hours: "", stress_level: "5", energy_level: "5" });

  const headers = { headers: { Authorization: `Bearer ${token}` } };
  const activeTasks = useMemo(() => tasks.filter((task) => !["completed", "skipped"].includes(task.status)), [tasks]);
  const historyTasks = useMemo(() => tasks.filter((task) => ["completed", "skipped"].includes(task.status)), [tasks]);
  const completedCount = historyTasks.filter((task) => task.status === "completed").length;
  const completionRate = historyTasks.length ? Math.round((completedCount / historyTasks.length) * 100) : 0;

  const requestNotifications = async () => {
    try {
      if (window.Capacitor) await LocalNotifications.requestPermissions();
    } catch { /* Browser notifications are optional. */ }
  };

  useEffect(() => { requestNotifications(); }, []);
  useEffect(() => { localStorage.setItem("ai_app_muted", String(muted)); }, [muted]);

  useEffect(() => {
    if (!token) return;
    loadSession();
  }, [token]);

  const loadSession = async () => {
    try {
      const me = await axios.get(`${API_BASE}/users/me`, headers);
      setUser(me.data);
      const saved = localStorage.getItem(storageKey(me.data.id));
      setTasks(saved ? JSON.parse(saved) : []);
      await Promise.all([loadTasks(), loadCoaching()]);
    } catch {
      logout();
      setAuthError("Your session expired. Please log in again.");
    }
  };

  const loadTasks = async () => {
    const result = await axios.get(`${API_BASE}/notifications/`, headers);
    const serverTasks = Array.isArray(result.data) ? result.data : (result.data.tasks || []);
    setTasks((previous) => {
      const savedOffline = previous.filter((task) => !serverTasks.some((serverTask) => serverTask.id === task.id));
      return [...serverTasks, ...savedOffline];
    });
  };

  const loadCoaching = async () => {
    const [coachResult, recommendationResult] = await Promise.all([
      axios.get(`${API_BASE}/users/me/ai-coach`, headers),
      axios.get(`${API_BASE}/users/me/recommendations`, headers),
    ]);
    setCoach(coachResult.data.tip || "Schedule your first task to start receiving coaching.");
    setInsight(recommendationResult.data.recommendation || "Your personal insights will appear here.");
  };

  useEffect(() => {
    if (user) localStorage.setItem(storageKey(user.id), JSON.stringify(tasks));
  }, [tasks, user]);

  const handleAuth = async (event) => {
    event.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      if (authMode === "signup") {
        await axios.post(`${API_BASE}/signup`, credentials);
        setAuthMode("login");
        setNotice("Account created. Please log in to continue.");
        return;
      }
      const result = await axios.post(`${API_BASE}/login`, credentials);
      const accessToken = result.data.access_token;
      if (!accessToken) throw new Error("The server did not return a session token.");
      localStorage.setItem("token", accessToken);
      setToken(accessToken);
    } catch (error) {
      setAuthError(error.response?.data?.detail || error.message || "Unable to sign in. Check your details and try again.");
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken("");
    setUser(null);
    setTasks([]);
    setPage("dashboard");
  };

  const scheduleNativeNotifications = async (task) => {
    if (muted || !window.Capacitor) return;
    const id = Number(String(task.id).slice(-6));
    const notifications = [];
    if (new Date(task.scheduled_time) > new Date()) notifications.push({ id, title: "Task starting", body: task.title, schedule: { at: new Date(task.scheduled_time) } });
    if (task.expected_end_time && new Date(task.expected_end_time) > new Date()) notifications.push({ id: id + 1, title: "Task ending", body: `How did ${task.title} go?`, schedule: { at: new Date(task.expected_end_time) } });
    if (notifications.length) await LocalNotifications.schedule({ notifications });
  };

  const createTask = async (event) => {
    event.preventDefault();
    if (!form.title || !form.start || !form.end) return setNotice("Add a title, start time, and end time.");
    const start = new Date(form.start);
    const end = new Date(form.end);
    if (end <= start) return setNotice("The end time must be after the start time.");
    try {
      const result = await axios.post(`${API_BASE}/tasks/`, null, { params: { title: form.title, scheduled_time: start.toISOString(), expected_end_time: end.toISOString() }, ...headers });
      const task = result.data;
      setTasks((previous) => [task, ...previous]);
      scheduleNativeNotifications(task);
      setForm({ title: "", start: "", end: "" });
      setNotice("Task scheduled and saved to your account.");
      setPage("dashboard");
    } catch (error) {
      setNotice(error.response?.data?.detail || "Task could not be saved. Check that the backend is running.");
    }
  };

  const openTask = (task) => {
    setSelectedTask(task);
    setResponse("completed");
    setNotes("");
    setRescheduleTime(dateTimeLocal(task.scheduled_time));
  };

  const updateTask = async () => {
    if (!selectedTask) return;
    if (response === "rescheduled" && !rescheduleTime) return setNotice("Choose a new start time before rescheduling.");
    try {
      const result = await axios.put(`${API_BASE}/tasks/${selectedTask.id}/respond`, null, {
        params: { user_response: response, notes, reschedule_time: response === "rescheduled" ? new Date(rescheduleTime).toISOString() : null },
        ...headers,
      });
      const updated = result.data.task;
      setTasks((previous) => previous.map((task) => task.id === updated.id ? updated : task));
      if (response === "rescheduled") {
        scheduleNativeNotifications(updated);
        setNotice(`Rescheduled for ${displayDate(updated.scheduled_time)}. The original duration was retained.`);
      } else {
        setNotice("Your task history and coaching have been updated.");
      }
      setSelectedTask(null);
      await loadCoaching();
    } catch (error) {
      setNotice(error.response?.data?.detail || "Task update failed. Please try again.");
    }
  };

  const applyPreset = (title, minutes) => {
    const start = new Date();
    const end = new Date(start.getTime() + minutes * 60000);
    setForm({ title, start: dateTimeLocal(start), end: dateTimeLocal(end) });
    setPage("schedule");
  };

  const completeOnboarding = async () => {
    setLoading(true);
    try {
      const profile = await axios.put(`${API_BASE}/users/me`, {
        name: profileForm.name,
        gender: profileForm.gender || null,
        date_of_birth: profileForm.date_of_birth ? new Date(profileForm.date_of_birth).toISOString() : null,
        use_case: profileForm.use_case,
        onboarding_complete: true,
      }, headers);
      await axios.post(`${API_BASE}/users/me/dynamic-data`, {
        study_hours: Number(profileForm.study_hours || 0), work_hours: Number(profileForm.work_hours || 0),
        sleep_hours: Number(profileForm.sleep_hours || 0), stress_level: Number(profileForm.stress_level || 0), energy_level: Number(profileForm.energy_level || 0),
      }, headers);
      setUser(profile.data.user);
      setNotice("Your workspace is ready. Your coaching will now adapt to your profile and check-ins.");
    } catch (error) { setNotice(error.response?.data?.detail || "We could not save your onboarding answers. Please try again."); }
    finally { setLoading(false); }
  };

  if (!token) return (
    <main className="auth-shell">
      <section className="auth-hero"><span className="brand-mark">◈</span><p className="eyebrow">YOUR PERSONAL OPERATING SYSTEM</p><h1>Make room for what matters.</h1><p>Plan focused days, learn from your routine, and build a life that feels intentional.</p><div className="hero-points"><span>✓ Private account history</span><span>✓ Adaptive coaching</span><span>✓ Thoughtful reminders</span></div></section>
      <section className="auth-panel"><div className="auth-card"><div className="brand">orbit<span>day</span></div><h2>{authMode === "login" ? "Welcome back" : "Create your space"}</h2><p>{authMode === "login" ? "Sign in to continue your routine." : "Your account keeps your plans and insights together."}</p>{notice && <div className="notice success">{notice}</div>}{authError && <div className="notice error">{authError}</div>}<form onSubmit={handleAuth}><label>Email address<input type="email" value={credentials.email} onChange={(e) => setCredentials({ ...credentials, email: e.target.value })} placeholder="you@example.com" required /></label><label>Password<input type="password" minLength="6" value={credentials.password} onChange={(e) => setCredentials({ ...credentials, password: e.target.value })} placeholder="At least 6 characters" required /></label><button className="primary-button" disabled={loading}>{loading ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}</button></form><button className="text-button" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(""); setNotice(""); }}>{authMode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button></div></section>
    </main>
  );

  if (user && !user.onboarding_complete) {
    const roleQuestion = profileForm.use_case === "student" ? "How many hours do you study on a typical day?" : "How many hours do you work on a typical day?";
    return <main className="onboarding-shell"><section className="onboarding-card"><div className="brand">orbit<span>day</span></div><div className="progress"><i style={{ width: `${((onboardingStep + 1) / 3) * 100}%` }} /></div><p className="eyebrow">A FEW QUICK QUESTIONS · {onboardingStep + 1} OF 3</p>{onboardingStep === 0 && <><h1>Let’s make this feel personal.</h1><p>We’ll use this only to tailor your daily workspace.</p><label>Your name<input autoFocus value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} placeholder="What should we call you?" /></label><label>Date of birth <span>(optional)</span><input type="date" value={profileForm.date_of_birth} onChange={(e) => setProfileForm({ ...profileForm, date_of_birth: e.target.value })} /></label></>}{onboardingStep === 1 && <><h1>What does your day revolve around?</h1><p>Your answer shapes the language and suggestions you see.</p><div className="role-options">{[["student", "I’m studying", "Plan learning and revision"], ["professional", "I’m working", "Protect focused work time"], ["personal", "Personal goals", "Build a healthier routine"]].map(([value, title, copy]) => <button key={value} className={profileForm.use_case === value ? "selected" : ""} onClick={() => setProfileForm({ ...profileForm, use_case: value })}><b>{title}</b><small>{copy}</small></button>)}</div></>}{onboardingStep === 2 && <><h1>One last check-in.</h1><p>This gives your first coaching suggestion a useful starting point.</p><label>{roleQuestion}<input type="number" min="0" max="24" value={profileForm.use_case === "student" ? profileForm.study_hours : profileForm.work_hours} onChange={(e) => setProfileForm({ ...profileForm, [profileForm.use_case === "student" ? "study_hours" : "work_hours"]: e.target.value })} placeholder="Hours" /></label><div className="two-column"><label>Average sleep<input type="number" min="0" max="24" value={profileForm.sleep_hours} onChange={(e) => setProfileForm({ ...profileForm, sleep_hours: e.target.value })} placeholder="Hours" /></label><label>Energy today (1–10)<input type="number" min="1" max="10" value={profileForm.energy_level} onChange={(e) => setProfileForm({ ...profileForm, energy_level: e.target.value })} /></label></div></>}{onboardingStep < 2 ? <button className="primary-button" disabled={onboardingStep === 0 && !profileForm.name.trim()} onClick={() => setOnboardingStep(onboardingStep + 1)}>Continue</button> : <button className="primary-button" disabled={loading} onClick={completeOnboarding}>{loading ? "Creating your space…" : "Open my workspace"}</button>}</section></main>;
  }

  const nav = [["dashboard", "Overview", "⌂"], ["schedule", "Plan", "+"], ["history", "History", "◷"], ["settings", "Settings", "⚙"]];
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand">orbit<span>day</span></div><p className="workspace-label">PERSONAL WORKSPACE</p><nav>{nav.map(([key, label, icon]) => <button key={key} className={page === key ? "nav-item active" : "nav-item"} onClick={() => setPage(key)}><span>{icon}</span>{label}</button>)}</nav><div className="sidebar-bottom"><div className="user-chip"><div>{(user?.name || user?.email || "U")[0].toUpperCase()}</div><span>{user?.name || user?.email}</span></div><button className="nav-item logout" onClick={logout}><span>↪</span>Log out</button></div></aside>
    <main className="workspace"><header className="topbar"><div><p className="eyebrow">{page === "dashboard" ? "GOOD TO SEE YOU" : "YOUR PERSONAL SPACE"}</p><h1>{page === "dashboard" ? `Hello${user?.name ? `, ${user.name}` : ""}.` : page[0].toUpperCase() + page.slice(1)}</h1></div><button className="notification-toggle" onClick={() => setMuted(!muted)}>{muted ? "Notifications off" : "Notifications on"}</button></header>{notice && <div className="notice success app-notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      {page === "dashboard" && <><section className="stats-grid"><article><span>ACTIVE PLANS</span><strong>{activeTasks.length}</strong><small>Ready for your attention</small></article><article><span>COMPLETED</span><strong>{completedCount}</strong><small>Tasks in your history</small></article><article><span>FOLLOW-THROUGH</span><strong>{completionRate}%</strong><small>Of logged tasks</small></article></section><section className="content-grid"><article className="panel wide"><div className="panel-heading"><div><p className="eyebrow">NEXT UP</p><h2>Your schedule</h2></div><button className="secondary-button" onClick={() => setPage("schedule")}>Plan a task</button></div>{activeTasks.length ? <div className="task-stack">{activeTasks.slice(0, 4).map((task) => <TaskRow key={task.id} task={task} onClick={() => openTask(task)} />)}</div> : <EmptyState title="A clear day starts with one plan." action="Schedule your first task" onClick={() => setPage("schedule")} />}</article><article className="panel coach-card"><p className="eyebrow">ADAPTIVE COACH</p><h2>Built around your history</h2><p>{coach}</p><hr /><p className="insight"><b>Pattern noticed</b>{insight}</p></article></section></>}
      {page === "schedule" && <section className="plan-layout"><article className="panel schedule-card"><p className="eyebrow">ADD TO YOUR DAY</p><h2>Schedule a focused block</h2><form className="task-form" onSubmit={createTask}><label>What do you want to do?<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Finish portfolio case study" required /></label><div className="two-column"><label>Start<input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} required /></label><label>End<input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} required /></label></div><button className="primary-button">Schedule task</button></form></article><article className="panel"><p className="eyebrow">START FASTER</p><h2>Routine templates</h2><div className="preset-list">{[["Morning workout", 45], ["Deep work session", 90], ["Read and learn", 30], ["Daily reflection", 20]].map(([title, minutes]) => <button key={title} onClick={() => applyPreset(title, minutes)}><span>{title}</span><small>{minutes} min</small></button>)}</div></article></section>}
      {page === "history" && <section className="panel"><div className="panel-heading"><div><p className="eyebrow">SAVED TO YOUR ACCOUNT</p><h2>Activity history</h2></div><span className="count-pill">{historyTasks.length} records</span></div>{historyTasks.length ? <div className="history-table">{historyTasks.map((task) => <div key={task.id} className="history-row"><div><b>{task.title}</b><small>{displayDate(task.scheduled_time)}</small>{task.user_reason && <em>“{task.user_reason}”</em>}</div><span className={`status ${task.status}`}>{task.status}</span></div>)}</div> : <EmptyState title="Completed plans will live here." action="View your schedule" onClick={() => setPage("dashboard")} />}</section>}
      {page === "settings" && <section className="settings-grid"><article className="panel"><p className="eyebrow">ACCOUNT</p><h2>Your data stays yours</h2><div className="settings-line"><span>Email address</span><b>{user?.email}</b></div><div className="settings-line"><span>Account ID</span><b>#{user?.id}</b></div><p className="muted-copy">Your tasks, status updates, notes, and coaching are stored against this account in PostgreSQL.</p></article><article className="panel"><p className="eyebrow">NOTIFICATIONS</p><h2>Stay in control</h2><div className="settings-line"><span>Task reminders</span><button className={muted ? "toggle" : "toggle on"} onClick={() => setMuted(!muted)}><i /></button></div><p className="muted-copy">Turn reminders on to receive start and end alerts for scheduled tasks.</p></article></section>}
    </main>
    {selectedTask && <div className="modal-backdrop" onMouseDown={() => setSelectedTask(null)}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="close-button" onClick={() => setSelectedTask(null)}>×</button><p className="eyebrow">UPDATE TASK</p><h2>{selectedTask.title}</h2><p className="task-date">Scheduled: {displayDate(selectedTask.scheduled_time)}</p><div className="response-options">{[["completed", "Completed"], ["rescheduled", "Reschedule"], ["skipped", "Skip"]].map(([key, label]) => <button key={key} className={response === key ? "selected" : ""} onClick={() => setResponse(key)}>{label}</button>)}</div>{response === "rescheduled" && <label>New start time<input type="datetime-local" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} required /><small>The original task duration will be retained automatically.</small></label>}<label>Reflection (optional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What helped or got in the way?" /></label><button className="primary-button" onClick={updateTask}>{response === "rescheduled" ? "Reschedule task" : "Save update"}</button></section></div>}
  </div>;
}

function TaskRow({ task, onClick }) { return <button className="task-row" onClick={onClick}><span className="task-icon">◷</span><span className="task-copy"><b>{task.title}</b><small>{displayDate(task.scheduled_time)}{task.expected_end_time ? ` — ${new Date(task.expected_end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</small></span><span className="task-action">Update →</span></button>; }
function EmptyState({ title, action, onClick }) { return <div className="empty-state"><div>✦</div><p>{title}</p><button className="secondary-button" onClick={onClick}>{action}</button></div>; }

export default App;
