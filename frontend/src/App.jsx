import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { LocalNotifications } from "@capacitor/local-notifications";
import "./App.css";

// VITE_API_BASE is set for custom/staging deployments. The public Render API
// is deliberately the fallback so a Vercel build never tries to call the
// visitor's own computer (localhost) in production.
const API_BASE = (import.meta.env.VITE_API_BASE || "https://ai-daily-backend-ldjh.onrender.com").replace(/\/$/, "");
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
const dateOnly = (value) => value ? String(value).slice(0, 10) : "";

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [page, setPage] = useState("dashboard");
  const [form, setForm] = useState({ title: "", start: "", end: "", durationHours: "", durationMinutes: "", priority: "medium" });
  const [selectedTask, setSelectedTask] = useState(null);
  const [response, setResponse] = useState("completed");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [notes, setNotes] = useState("");
  const [coach, setCoach] = useState("");
  const [insight, setInsight] = useState("");
  const [secondMind, setSecondMind] = useState(null);
  const [coachQuestion, setCoachQuestion] = useState("");
  const [coachMessages, setCoachMessages] = useState([]);
  const [coachSending, setCoachSending] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem("ai_app_muted") === "true");
  const [notice, setNotice] = useState("");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [profileForm, setProfileForm] = useState({ name: "", date_of_birth: "", gender: "", use_case: "student", study_hours: "", work_hours: "", sleep_hours: "", stress_level: "5", energy_level: "5" });
  const [accountForm, setAccountForm] = useState({ name: "", age: "", date_of_birth: "", gender: "", use_case: "student", preferred_focus_time: "", planning_style: "", daily_screen_time: "", preferred_task_difficulty: "", study_hours: "", work_hours: "", sleep_hours: "", exercise_minutes: "", water_goal: "", energy_level: "", stress_level: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [dailyCheckIn, setDailyCheckIn] = useState(null);
  const [routineDate, setRoutineDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [routineTimes, setRoutineTimes] = useState({ wake_up: "", breakfast: "", commute: "", work_start: "", lunch: "", study: "", exercise: "", chores: "", dinner: "", entertainment: "", social_time: "", wind_down: "", sleep: "" });
  const [routineLoading, setRoutineLoading] = useState(false);

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
    if (!user) return;
    setAccountForm({
      name: user.name || "",
      age: user.age ?? "",
      date_of_birth: dateOnly(user.date_of_birth),
      gender: user.gender || "",
      use_case: user.use_case || "student",
      preferred_focus_time: user.preferred_focus_time || "",
      planning_style: user.planning_style || "",
      daily_screen_time: user.daily_screen_time ?? "",
      preferred_task_difficulty: user.preferred_task_difficulty || "",
      study_hours: dailyCheckIn?.study_hours ?? "",
      work_hours: dailyCheckIn?.work_hours ?? "",
      sleep_hours: dailyCheckIn?.sleep_hours ?? "",
      exercise_minutes: dailyCheckIn?.exercise_minutes ?? "",
      water_goal: dailyCheckIn?.water_goal ?? "",
      energy_level: dailyCheckIn?.energy_level ?? "",
      stress_level: dailyCheckIn?.stress_level ?? "",
    });
    setProfileEditing(false);
  }, [user, dailyCheckIn]);

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
      await Promise.all([loadTasks(), loadCoaching(), loadDailyCheckIn()]);
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
    const [coachResult, recommendationResult, secondMindResult] = await Promise.all([
      axios.get(`${API_BASE}/users/me/ai-coach`, headers),
      axios.get(`${API_BASE}/users/me/recommendations`, headers),
      axios.get(`${API_BASE}/users/me/second-mind`, headers),
    ]);
    setCoach(coachResult.data.tip || "Schedule your first task to start receiving coaching.");
    setInsight(recommendationResult.data.adaptive_plan || recommendationResult.data.recommendation || "Your next personalized plan will appear here.");
    setSecondMind(secondMindResult.data);
  };

  const loadDailyCheckIn = async () => {
    const result = await axios.get(`${API_BASE}/users/me/dynamic-data/latest`, headers);
    setDailyCheckIn(result.data);
  };

  const askCoach = async (event) => {
    event.preventDefault();
    const question = coachQuestion.trim();
    if (!question || coachSending) return;
    setCoachMessages((previous) => [...previous, { role: "user", text: question }]);
    setCoachQuestion("");
    setCoachSending(true);
    try {
      const result = await axios.post(`${API_BASE}/users/me/coach/messages`, { message: question }, headers);
      setCoachMessages((previous) => [...previous, { role: "assistant", text: result.data.answer }]);
      setSecondMind(result.data);
    } catch (error) {
      setCoachMessages((previous) => [...previous, { role: "assistant", text: error.response?.data?.detail || "I could not review your plan right now. Please try again." }]);
    } finally {
      setCoachSending(false);
    }
  };

  const loadRoutine = async (selectedDate = routineDate) => {
    try {
      const result = await axios.get(`${API_BASE}/users/me/time-entries`, { params: { date: selectedDate }, ...headers });
      const nextTimes = { wake_up: "", breakfast: "", commute: "", work_start: "", lunch: "", study: "", exercise: "", chores: "", dinner: "", entertainment: "", social_time: "", wind_down: "", sleep: "" };
      result.data.forEach((entry) => {
        const local = new Date(entry.occurred_at);
        nextTimes[entry.activity] = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
      });
      setRoutineTimes(nextTimes);
    } catch (error) {
      setNotice(error.response?.data?.detail || "Could not load your routine times.");
    }
  };

  const changeRoutineDate = (value) => {
    setRoutineDate(value);
    if (value) loadRoutine(value);
  };

  const saveRoutine = async (event) => {
    event.preventDefault();
    const entries = Object.entries(routineTimes)
      .filter(([, time]) => time)
      .map(([activity, time]) => ({ activity, occurred_at: `${routineDate}T${time}:00` }));
    if (!entries.length) return setNotice("Add at least one time to save your daily routine.");
    setRoutineLoading(true);
    try {
      await axios.post(`${API_BASE}/users/me/time-entries`, { entries }, headers);
      setNotice("Routine times saved. They will improve future schedule suggestions.");
      await loadRoutine();
    } catch (error) {
      setNotice(error.response?.data?.detail || "Could not save your routine times. Please try again.");
    } finally {
      setRoutineLoading(false);
    }
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
    if (!form.title || !form.start || !form.end) return setNotice("Add a title, start window, and deadline.");
    const start = new Date(form.start);
    const endWindow = new Date(form.end);
    const durationMinutes = (Number(form.durationHours || 0) * 60) + Number(form.durationMinutes || 0);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return setNotice("Set how long this task should take.");
    if (endWindow <= start) return setNotice("The deadline must be after the start window.");
    if (start.getTime() + durationMinutes * 60000 > endWindow.getTime()) return setNotice("The estimated duration must fit before the deadline.");
    try {
      const result = await axios.post(`${API_BASE}/tasks/`, { title: form.title, start_time: start.toISOString(), end_time: endWindow.toISOString(), duration_minutes: durationMinutes, priority: form.priority }, headers);
      const task = result.data;
      setTasks((previous) => [task, ...previous]);
      scheduleNativeNotifications(task);
      setForm({ title: "", start: "", end: "", durationHours: "", durationMinutes: "", priority: "medium" });
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
    setForm({ title, start: dateTimeLocal(start), end: dateTimeLocal(new Date(start.getTime() + (minutes * 2) * 60000)), durationHours: String(Math.floor(minutes / 60)), durationMinutes: String(minutes % 60), priority: "medium" });
    setPage("schedule");
  };

  const completeOnboarding = async () => {
    setLoading(true);
    try {
      const profile = await axios.put(`${API_BASE}/users/me`, {
        name: profileForm.name,
        gender: profileForm.gender || null,
        date_of_birth: profileForm.date_of_birth ? `${profileForm.date_of_birth}T00:00:00Z` : null,
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

  const saveProfile = async (event) => {
    event.preventDefault();
    setProfileSaving(true);
    try {
      const result = await axios.put(`${API_BASE}/users/me`, {
        ...accountForm,
        age: accountForm.age === "" ? null : Number(accountForm.age),
        date_of_birth: accountForm.date_of_birth ? `${accountForm.date_of_birth}T00:00:00Z` : null,
        daily_screen_time: accountForm.daily_screen_time === "" ? null : Number(accountForm.daily_screen_time),
      }, headers);
      const dailyResult = await axios.put(`${API_BASE}/users/me/dynamic-data/latest`, {
        study_hours: Number(accountForm.study_hours || 0), work_hours: Number(accountForm.work_hours || 0),
        sleep_hours: Number(accountForm.sleep_hours || 0), exercise_minutes: Number(accountForm.exercise_minutes || 0),
        water_goal: Number(accountForm.water_goal || 0), energy_level: Number(accountForm.energy_level || 0),
        stress_level: Number(accountForm.stress_level || 0), mood: dailyCheckIn?.mood || null,
      }, headers);
      setUser(result.data.user);
      setDailyCheckIn(dailyResult.data);
      setNotice("Your profile has been updated.");
      setProfileEditing(false);
    } catch (error) {
      setNotice(error.response?.data?.detail || "Your profile could not be updated. Please try again.");
    } finally {
      setProfileSaving(false);
    }
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

  const nav = [["dashboard", "Overview", "⌂"], ["schedule", "Plan", "+"], ["routine", "Routine", "◔"], ["coach", "Ask Orbit", "✦"], ["history", "History", "◷"], ["settings", "Settings", "⚙"]];
  return <div className="app-shell">
    <aside className="sidebar"><button className="brand brand-button" onClick={() => setPage("dashboard")} aria-label="Go to dashboard">orbit<span>day</span></button><p className="workspace-label">PERSONAL WORKSPACE</p><nav>{nav.map(([key, label, icon]) => <button key={key} className={page === key ? "nav-item active" : "nav-item"} onClick={() => { setPage(key); if (key === "routine") loadRoutine(); }}><span>{icon}</span>{label}</button>)}</nav><div className="sidebar-bottom"><button className="user-chip" onClick={() => setPage("settings")} title="Open profile"><div>{(user?.name || user?.email || "U")[0].toUpperCase()}</div><span>{user?.name || user?.email}</span></button><button className="nav-item logout" onClick={logout}><span>↪</span>Log out</button></div></aside>
    <main className="workspace"><header className="topbar"><div><p className="eyebrow">{page === "dashboard" ? "GOOD TO SEE YOU" : "YOUR PERSONAL SPACE"}</p><h1>{page === "dashboard" ? `Hello${user?.name ? `, ${user.name}` : ""}.` : page[0].toUpperCase() + page.slice(1)}</h1></div><button className="notification-toggle" onClick={() => setMuted(!muted)}>{muted ? "Notifications off" : "Notifications on"}</button></header>{notice && <div className="notice success app-notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      {page === "dashboard" && <><section className="stats-grid"><article><span>ACTIVE PLANS</span><strong>{activeTasks.length}</strong><small>Ready for your attention</small></article><article><span>COMPLETED</span><strong>{completedCount}</strong><small>Tasks in your history</small></article><article><span>FOLLOW-THROUGH</span><strong>{completionRate}%</strong><small>Of logged tasks</small></article></section><section className="content-grid"><article className="panel wide"><div className="panel-heading"><div><p className="eyebrow">NEXT UP</p><h2>Your schedule</h2></div><button className="secondary-button" onClick={() => setPage("schedule")}>Plan a task</button></div>{activeTasks.length ? <div className="task-stack">{activeTasks.slice(0, 4).map((task) => <TaskRow key={task.id} task={task} onClick={() => openTask(task)} />)}</div> : <EmptyState title="A clear day starts with one plan." action="Schedule your first task" onClick={() => setPage("schedule")} />}</article><article className="panel coach-card"><p className="eyebrow">YOUR SECOND MIND</p><h2>Best next move</h2><p>{secondMind?.answer || coach}</p><hr /><p className="insight"><b>{secondMind?.suggested_time ? `Suggested time · ${secondMind.suggested_time}` : "Suggested next step"}</b>{insight}</p><button className="secondary-button coach-link" onClick={() => setPage("coach")}>Ask Orbit</button></article></section></>}
      {page === "schedule" && <section className="plan-layout"><article className="panel schedule-card"><p className="eyebrow">ADD TO YOUR DAY</p><h2>Plan a task window</h2><form className="task-form" onSubmit={createTask}><label>What do you want to do?<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Finish college assignment" required /></label><div className="two-column"><label>Available from<input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} required /></label><label>Deadline / end window<input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} required /></label></div><div className="duration-field"><span>Estimated effort</span><div><input type="number" min="0" max="720" value={form.durationHours} onChange={(e) => setForm({ ...form, durationHours: e.target.value })} placeholder="Hours" aria-label="Duration hours" /><input type="number" min="0" max="59" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} placeholder="Minutes" aria-label="Duration minutes" /></div><small>Orbit uses this duration to find a free slot inside your available window.</small></div><label>Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="high">High — do this first if plans overlap</option><option value="medium">Medium — normal priority</option><option value="low">Low — flexible</option></select></label><button className="primary-button">Add to plan</button></form></article><article className="panel"><p className="eyebrow">START FASTER</p><h2>Routine templates</h2><div className="preset-list">{[["Morning workout", 45], ["Deep work session", 90], ["Read and learn", 30], ["Daily reflection", 20]].map(([title, minutes]) => <button key={title} onClick={() => applyPreset(title, minutes)}><span>{title}</span><small>{minutes} min</small></button>)}</div></article></section>}
      {page === "routine" && <section className="routine-layout"><article className="panel"><p className="eyebrow">DAILY TIME CHECK-IN</p><h2>When did your day happen?</h2><p className="muted-copy routine-intro">A few quick timestamps help Orbit Day learn your real rhythm. Leave anything blank that you do not want to track.</p><form className="task-form" onSubmit={saveRoutine}><label>Day<input type="date" value={routineDate} onChange={(e) => changeRoutineDate(e.target.value)} required /></label><div className="routine-grid">{[["wake_up", "Wake up", "☀"], ["breakfast", "Breakfast", "◌"], ["commute", "Travel / commute", "↔"], ["work_start", "Start work", "▣"], ["lunch", "Lunch", "◐"], ["study", "Study time", "◫"], ["exercise", "Exercise", "✦"], ["chores", "Chores", "⌂"], ["dinner", "Dinner", "◑"], ["entertainment", "Entertainment", "▶"], ["social_time", "Social time", "♡"], ["wind_down", "Wind down", "☾"], ["sleep", "Go to sleep", "◒"]].map(([key, label, icon]) => <label key={key} className="routine-entry"><span className="routine-icon">{icon}</span><span>{label}</span><input type="time" value={routineTimes[key]} onChange={(e) => setRoutineTimes({ ...routineTimes, [key]: e.target.value })} /></label>)}</div><button className="primary-button" disabled={routineLoading}>{routineLoading ? "Saving routine…" : "Save today’s times"}</button></form></article><article className="panel routine-help"><p className="eyebrow">WHY THIS MATTERS</p><h2>Better timing, less effort</h2><p>Travel, study, work, chores and entertainment reveal where real time goes—not just your ideal schedule.</p><p className="muted-copy">You never need to log every detail of your day—just the moments that make your routine recognizable.</p></article></section>}
      {page === "coach" && <section className="coach-layout"><article className="panel coach-conversation"><p className="eyebrow">ORBIT, YOUR SECOND MIND</p><h2>Think through your day</h2><p className="muted-copy">Ask about the best time for work, what to do next, or whether you should rest.</p><div className="message-stack"><div className="coach-message assistant">{secondMind?.answer || "I’m reviewing your task history and routine."}</div>{coachMessages.map((message, index) => <div key={index} className={`coach-message ${message.role}`}>{message.text}</div>)}</div><form className="coach-form" onSubmit={askCoach}><input value={coachQuestion} onChange={(e) => setCoachQuestion(e.target.value)} placeholder="e.g. When should I study today?" maxLength="500" /><button className="primary-button" disabled={coachSending}>{coachSending ? "Thinking…" : "Ask Orbit"}</button></form></article><article className="panel coach-facts"><p className="eyebrow">TODAY’S REASONING</p><h2>What Orbit is using</h2><div className="settings-line"><span>Suggested focus time</span><b>{secondMind?.suggested_time || "Learning your routine"}</b></div><div className="settings-line"><span>Next-step priority</span><b>{secondMind?.priority || "Medium"}</b></div><p className="muted-copy">{secondMind?.reason || "Complete a few tasks and save routine times so Orbit can recognize your most useful hours."}</p></article></section>}
      {page === "history" && <section className="panel"><div className="panel-heading"><div><p className="eyebrow">SAVED TO YOUR ACCOUNT</p><h2>Activity history</h2></div><span className="count-pill">{historyTasks.length} records</span></div>{historyTasks.length ? <div className="history-table">{historyTasks.map((task) => <div key={task.id} className="history-row"><div><b>{task.title}</b><small>{displayDate(task.scheduled_time)}</small>{task.user_reason && <em>“{task.user_reason}”</em>}</div><span className={`status ${task.status}`}>{task.status}</span></div>)}</div> : <EmptyState title="Completed plans will live here." action="View your schedule" onClick={() => setPage("dashboard")} />}</section>}
      {page === "settings" && <section className="settings-grid"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">PROFILE</p><h2>About you</h2></div>{!profileEditing && <button className="secondary-button" onClick={() => setProfileEditing(true)}>Edit profile</button>}</div>{!profileEditing ? <div className="profile-summary"><div className="settings-line"><span>Name</span><b>{user?.name || "Not provided"}</b></div><div className="settings-line"><span>Email</span><b>{user?.email}</b></div><div className="settings-line"><span>Age</span><b>{user?.age || "Not provided"}</b></div><div className="settings-line"><span>Date of birth</span><b>{dateOnly(user?.date_of_birth) || "Not provided"}</b></div><div className="settings-line"><span>Gender</span><b>{user?.gender || "Not provided"}</b></div><div className="settings-line"><span>Primary focus</span><b>{user?.use_case || "Not provided"}</b></div><div className="settings-line"><span>Best focus period</span><b>{user?.preferred_focus_time || "Not provided"}</b></div><div className="settings-line"><span>Planning style</span><b>{user?.planning_style || "Not provided"}</b></div><div className="settings-line"><span>Daily screen time</span><b>{user?.daily_screen_time ? `${user.daily_screen_time} hours` : "Not provided"}</b></div><div className="settings-line"><span>Usual task difficulty</span><b>{user?.preferred_task_difficulty || "Not provided"}</b></div><p className="eyebrow profile-section-label">LATEST DAILY CHECK-IN</p>{dailyCheckIn ? <div className="checkin-grid"><span>Study <b>{dailyCheckIn.study_hours || 0}h</b></span><span>Work <b>{dailyCheckIn.work_hours || 0}h</b></span><span>Sleep <b>{dailyCheckIn.sleep_hours || 0}h</b></span><span>Workout <b>{dailyCheckIn.exercise_minutes || 0} min</b></span><span>Water goal <b>{dailyCheckIn.water_goal || 0}</b></span><span>Mood <b>{dailyCheckIn.mood || "Not provided"}</b></span><span>Energy <b>{dailyCheckIn.energy_level || 0}/10</b></span><span>Stress <b>{dailyCheckIn.stress_level || 0}/10</b></span></div> : <p className="muted-copy">No daily check-in saved yet.</p>}<p className="muted-copy">Your saved profile is locked. Select Edit profile to make changes.</p></div> : <form className="profile-form" onSubmit={saveProfile}><label>Name<input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} required /></label><label>Email address<input value={user?.email || ""} disabled /></label><div className="two-column"><label>Age<input type="number" min="1" max="120" value={accountForm.age} onChange={(e) => setAccountForm({ ...accountForm, age: e.target.value })} /></label><label>Date of birth<input type="date" value={accountForm.date_of_birth} onChange={(e) => setAccountForm({ ...accountForm, date_of_birth: e.target.value })} /></label></div><div className="two-column"><label>Gender<select value={accountForm.gender} onChange={(e) => setAccountForm({ ...accountForm, gender: e.target.value })}><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="non-binary">Non-binary</option><option value="other">Other</option></select></label><label>Primary focus<select value={accountForm.use_case} onChange={(e) => setAccountForm({ ...accountForm, use_case: e.target.value })}><option value="student">Studying</option><option value="professional">Professional work</option><option value="personal">Personal goals</option></select></label></div><details className="more-profile"><summary>More about you (optional)</summary><p>These answers help the planning model estimate realistic workload and completion chances.</p><div className="two-column"><label>Daily screen time (hours)<input type="number" min="0" max="24" step="0.5" value={accountForm.daily_screen_time} onChange={(e) => setAccountForm({ ...accountForm, daily_screen_time: e.target.value })} /></label><label>Usual task difficulty<select value={accountForm.preferred_task_difficulty} onChange={(e) => setAccountForm({ ...accountForm, preferred_task_difficulty: e.target.value })}><option value="">Choose difficulty</option><option value="easy">Mostly easy</option><option value="medium">Mostly medium</option><option value="hard">Mostly hard</option></select></label></div><div className="two-column"><label>When do you focus best?<select value={accountForm.preferred_focus_time} onChange={(e) => setAccountForm({ ...accountForm, preferred_focus_time: e.target.value })}><option value="">Choose a time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option><option value="varies">It varies</option></select></label><label>How do you like to plan?<select value={accountForm.planning_style} onChange={(e) => setAccountForm({ ...accountForm, planning_style: e.target.value })}><option value="">Choose a style</option><option value="structured">Structured schedule</option><option value="flexible">Flexible task list</option><option value="mixed">A mix of both</option></select></label></div></details><details className="more-profile" open><summary>Daily baseline</summary><p>These values keep the editable profile in sync with your latest daily check-in.</p><div className="two-column"><label>Daily study hours<input type="number" min="0" max="24" step="0.5" value={accountForm.study_hours} onChange={(e) => setAccountForm({ ...accountForm, study_hours: e.target.value })} /></label><label>Daily work hours<input type="number" min="0" max="24" step="0.5" value={accountForm.work_hours} onChange={(e) => setAccountForm({ ...accountForm, work_hours: e.target.value })} /></label></div><div className="two-column"><label>Average sleep (hours)<input type="number" min="0" max="24" step="0.5" value={accountForm.sleep_hours} onChange={(e) => setAccountForm({ ...accountForm, sleep_hours: e.target.value })} /></label><label>Daily workout (minutes)<input type="number" min="0" max="1440" value={accountForm.exercise_minutes} onChange={(e) => setAccountForm({ ...accountForm, exercise_minutes: e.target.value })} /></label></div><div className="two-column"><label>Water goal<input type="number" min="0" step="0.1" value={accountForm.water_goal} onChange={(e) => setAccountForm({ ...accountForm, water_goal: e.target.value })} /></label><label>Baseline energy (0–10)<input type="number" min="0" max="10" value={accountForm.energy_level} onChange={(e) => setAccountForm({ ...accountForm, energy_level: e.target.value })} /></label></div><label>Baseline stress (0–10)<input type="number" min="0" max="10" value={accountForm.stress_level} onChange={(e) => setAccountForm({ ...accountForm, stress_level: e.target.value })} /></label></details><div className="profile-actions"><button type="button" className="secondary-button" onClick={() => setProfileEditing(false)}>Cancel</button><button className="primary-button" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save profile"}</button></div></form>}</article><article className="panel"><p className="eyebrow">NOTIFICATIONS</p><h2>Stay in control</h2><div className="settings-line"><span>Task reminders</span><button className={muted ? "toggle" : "toggle on"} onClick={() => setMuted(!muted)}><i /></button></div><p className="muted-copy">Turn reminders on to receive start and end alerts for scheduled tasks.</p></article></section>}
    </main>
    {selectedTask && <div className="modal-backdrop" onMouseDown={() => setSelectedTask(null)}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="close-button" onClick={() => setSelectedTask(null)}>×</button><p className="eyebrow">UPDATE TASK</p><h2>{selectedTask.title}</h2><p className="task-date">Scheduled: {displayDate(selectedTask.scheduled_time)}</p><div className="response-options">{[["completed", "Completed"], ["rescheduled", "Reschedule"], ["skipped", "Skip"]].map(([key, label]) => <button key={key} className={response === key ? "selected" : ""} onClick={() => setResponse(key)}>{label}</button>)}</div>{response === "rescheduled" && <label>New start time<input type="datetime-local" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} required /><small>The original task duration will be retained automatically.</small></label>}<label>Reflection (optional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What helped or got in the way?" /></label><button className="primary-button" onClick={updateTask}>{response === "rescheduled" ? "Reschedule task" : "Save update"}</button></section></div>}
  </div>;
}

function TaskRow({ task, onClick }) { return <button className="task-row" onClick={onClick}><span className="task-icon">◷</span><span className="task-copy"><b>{task.title}</b><small>{displayDate(task.scheduled_time)}{task.expected_end_time ? ` — ${new Date(task.expected_end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</small></span><span className={`priority ${task.priority || "medium"}`}>{task.priority || "medium"}</span><span className="task-action">Update →</span></button>; }
function EmptyState({ title, action, onClick }) { return <div className="empty-state"><div>✦</div><p>{title}</p><button className="secondary-button" onClick={onClick}>{action}</button></div>; }

export default App;
