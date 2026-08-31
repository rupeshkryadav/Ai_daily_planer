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
const ESSENTIAL_ROUTINE = ["wake_up", "work_start", "lunch", "dinner", "sleep"];
const ROUTINE_META = {
  wake_up: ["Wake up", "☀"], work_start: ["Start work / college", "▣"], lunch: ["Lunch", "◐"], dinner: ["Dinner", "◑"], sleep: ["Go to sleep", "◒"],
  exercise: ["Exercise", "✦"], study: ["Study time", "◫"], wind_down: ["Wind down", "☾"],
};

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState(() => window.location.pathname === "/signup" ? "signup" : ["/reset-password", "/forgot-password"].includes(window.location.pathname) ? "reset" : "login");
  const [credentials, setCredentials] = useState({ name: "", email: "", password: "" });
  const [resetForm, setResetForm] = useState(() => ({ email: "", token: new URLSearchParams(window.location.search).get("token") || "", newPassword: "", confirmPassword: "" }));
  const [resetRequested, setResetRequested] = useState(() => Boolean(new URLSearchParams(window.location.search).get("token")));
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [page, setPage] = useState("dashboard");
  const [form, setForm] = useState({ title: "", start: "", end: "", durationHours: "", durationMinutes: "", priority: "medium", taskDifficulty: "", currentEnergy: "", currentStress: "" });
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskDetail, setTaskDetail] = useState(null);
  const [response, setResponse] = useState("completed");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleEndTime, setRescheduleEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [editDifficulty, setEditDifficulty] = useState("");
  const [coach, setCoach] = useState("");
  const [insight, setInsight] = useState("");
  const [secondMind, setSecondMind] = useState(null);
  const [coachQuestion, setCoachQuestion] = useState("");
  const [coachMessages, setCoachMessages] = useState([]);
  const [coachSessions, setCoachSessions] = useState([]);
  const [activeCoachSessionId, setActiveCoachSessionId] = useState(null);
  const [coachSending, setCoachSending] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem("ai_app_muted") === "true");
  const [notice, setNotice] = useState("");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [profileForm, setProfileForm] = useState({ name: "", date_of_birth: "", gender: "", use_case: "student", daily_free_hours: "", study_hours: "", work_hours: "", sleep_hours: "", stress_level: "5", energy_level: "5" });
  const [accountForm, setAccountForm] = useState({ name: "", age: "", date_of_birth: "", gender: "", use_case: "student", preferred_focus_time: "", planning_style: "", daily_screen_time: "", daily_free_hours: "", preferred_task_difficulty: "", study_hours: "", work_hours: "", sleep_hours: "", exercise_minutes: "", water_goal: "", energy_level: "", stress_level: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [dailyCheckIn, setDailyCheckIn] = useState(null);
  const [routineDate, setRoutineDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [routineTimes, setRoutineTimes] = useState({ wake_up: "", breakfast: "", commute: "", work_start: "", lunch: "", study: "", exercise: "", chores: "", dinner: "", entertainment: "", social_time: "", wind_down: "", sleep: "" });
  const [routineActivities, setRoutineActivities] = useState(ESSENTIAL_ROUTINE);
  const [customRoutineName, setCustomRoutineName] = useState("");
  const [routinePromptChecked, setRoutinePromptChecked] = useState(false);
  const [onboardingActivities, setOnboardingActivities] = useState({ wake_up: true, work_start: true, sleep: true, exercise: false, study: false, lunch: false, dinner: false });
  const [routineLoading, setRoutineLoading] = useState(false);
  const [scheduleAdvice, setScheduleAdvice] = useState(null);
  const [wrapUpOpen, setWrapUpOpen] = useState(false);
  const [routineReview, setRoutineReview] = useState("followed");
  const [wrapUpNotes, setWrapUpNotes] = useState("");
  const resetTokenInUrl = new URLSearchParams(window.location.search).get("token");
  const isForgotPassword = window.location.pathname === "/forgot-password";

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
  useEffect(() => {
    const syncAuthScreen = () => {
      setAuthMode(window.location.pathname === "/signup" ? "signup" : ["/reset-password", "/forgot-password"].includes(window.location.pathname) ? "reset" : "login");
      const linkedToken = new URLSearchParams(window.location.search).get("token");
      if (linkedToken) { setResetForm((previous) => ({ ...previous, token: linkedToken })); setResetRequested(true); }
    };
    window.addEventListener("popstate", syncAuthScreen);
    return () => window.removeEventListener("popstate", syncAuthScreen);
  }, []);
  useEffect(() => {
    if (!token && !["/login", "/signup", "/reset-password"].includes(window.location.pathname)) {
      window.history.replaceState({}, "", "/login");
    }
  }, [token]);
  useEffect(() => { localStorage.setItem("ai_app_muted", String(muted)); }, [muted]);
  useEffect(() => {
    if (!user) return;
    setProfileForm((previous) => ({ ...previous, name: previous.name || user.name || "", date_of_birth: previous.date_of_birth || dateOnly(user.date_of_birth) }));
    setAccountForm({
      name: user.name || "",
      age: user.age ?? "",
      date_of_birth: dateOnly(user.date_of_birth),
      gender: user.gender || "",
      use_case: user.use_case || "student",
      preferred_focus_time: user.preferred_focus_time || "",
      planning_style: user.planning_style || "",
      daily_screen_time: user.daily_screen_time ?? "",
      daily_free_hours: user.daily_free_hours ?? "",
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
    setForm((previous) => ({ ...previous,
      currentEnergy: previous.currentEnergy || String(dailyCheckIn?.energy_level ?? "5"),
      currentStress: previous.currentStress || String(dailyCheckIn?.stress_level ?? "5"),
    }));
  }, [dailyCheckIn]);

  useEffect(() => {
    if (!token) return;
    loadSession();
  }, [token]);

  useEffect(() => {
    if (!user?.onboarding_complete || routinePromptChecked) return;
    const today = new Date().toISOString().slice(0, 10);
    const visitKey = `orbit_routine_done_or_dismissed_${user.id}_${today}`;
    if (user.last_routine_completed_date === today || localStorage.getItem(visitKey)) { setRoutinePromptChecked(true); return; }
    axios.get(`${API_BASE}/users/me/time-entries`, { params: { date: today }, ...headers })
      .then((result) => { if (!result.data?.length) setPage("routine"); else localStorage.setItem(visitKey, "saved"); })
      .catch(() => { /* Do not block the dashboard if routine data is unavailable. */ })
      .finally(() => setRoutinePromptChecked(true));
  }, [user, routinePromptChecked]);

  useEffect(() => {
    const durationMinutes = (Number(form.durationHours || 0) * 60) + Number(form.durationMinutes || 0);
    if (page !== "schedule" || !token || !form.title.trim() || !form.start || !form.end || durationMinutes <= 0) {
      setScheduleAdvice(null);
      return undefined;
    }
    const start = new Date(form.start);
    const end = new Date(form.end);
    if (end <= start || start.getTime() + durationMinutes * 60000 > end.getTime()) {
      setScheduleAdvice(null);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      try {
        const result = await axios.post(`${API_BASE}/tasks/schedule-advice`, {
          title: form.title, start_time: start.toISOString(), end_time: end.toISOString(),
          duration_minutes: durationMinutes, priority: form.priority, task_difficulty: form.taskDifficulty || null,
          current_energy_level: Number(form.currentEnergy || 5), current_stress_level: Number(form.currentStress || 5),
        }, { headers: { Authorization: `Bearer ${token}` } });
        setScheduleAdvice(result.data);
      } catch {
        setScheduleAdvice(null);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [page, token, form.title, form.start, form.end, form.durationHours, form.durationMinutes, form.priority, form.taskDifficulty, form.currentEnergy, form.currentStress]);

  useEffect(() => {
    if (!user || !tasks.length || new Date().getHours() < 20) return;
    const today = new Date().toISOString().slice(0, 10);
    const reviewKey = `orbit_daily_review_${user.id}_${today}`;
    const needsReview = tasks.some((task) => dateOnly(task.scheduled_time) === today && !["completed", "skipped"].includes(task.status));
    if (needsReview && !localStorage.getItem(reviewKey)) setWrapUpOpen(true);
  }, [user, tasks]);

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
    const [coachResult, recommendationResult, secondMindResult, sessionsResult] = await Promise.all([
      axios.get(`${API_BASE}/users/me/ai-coach`, headers),
      axios.get(`${API_BASE}/users/me/recommendations`, headers),
      axios.get(`${API_BASE}/users/me/second-mind`, headers),
      axios.get(`${API_BASE}/users/me/coach/sessions`, headers),
    ]);
    setCoach(coachResult.data.tip || "Schedule your first task to start receiving coaching.");
    setInsight(recommendationResult.data.adaptive_plan || recommendationResult.data.recommendation || "Your next personalized plan will appear here.");
    setSecondMind(secondMindResult.data);
    const sessions = Array.isArray(sessionsResult.data) ? sessionsResult.data : [];
    setCoachSessions(sessions);
    const sessionId = activeCoachSessionId || sessions[0]?.id;
    if (sessionId) await loadCoachMessages(sessionId);
  };

  const loadCoachMessages = async (sessionId) => {
    setActiveCoachSessionId(sessionId);
    const result = await axios.get(`${API_BASE}/users/me/coach/messages`, { params: { session_id: sessionId }, ...headers });
    setCoachMessages(Array.isArray(result.data) ? result.data : []);
  };

  const newCoachChat = async () => {
    try {
      const result = await axios.post(`${API_BASE}/users/me/coach/sessions`, {}, headers);
      setCoachSessions((previous) => [result.data, ...previous]);
      setActiveCoachSessionId(result.data.id);
      setCoachMessages([]);
      setPage("coach");
    } catch (error) { setNotice(error.response?.data?.detail || "Could not start a new chat."); }
  };

  const deleteCoachChat = async (sessionId) => {
    try {
      await axios.delete(`${API_BASE}/users/me/coach/sessions/${sessionId}`, headers);
      const remaining = coachSessions.filter((session) => session.id !== sessionId);
      setCoachSessions(remaining);
      if (activeCoachSessionId === sessionId) {
        const nextSession = remaining[0];
        if (nextSession) await loadCoachMessages(nextSession.id);
        else { setActiveCoachSessionId(null); setCoachMessages([]); }
      }
      setNotice("Chat deleted.");
    } catch (error) { setNotice(error.response?.data?.detail || "Could not delete this chat."); }
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
      const result = await axios.post(`${API_BASE}/users/me/coach/messages`, {
        message: question,
        session_id: activeCoachSessionId,
        client_time: new Date().toISOString(),
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      }, headers);
      setCoachMessages((previous) => [...previous, { role: "assistant", text: result.data.answer }]);
      if (result.data.task_created) {
        setTasks((previous) => [result.data.task_created, ...previous.filter((task) => task.id !== result.data.task_created.id)]);
        scheduleNativeNotifications(result.data.task_created);
        await loadTasks();
      }
      if (result.data.session_id) setActiveCoachSessionId(result.data.session_id);
      setSecondMind(result.data);
      const sessionsResult = await axios.get(`${API_BASE}/users/me/coach/sessions`, headers);
      setCoachSessions(sessionsResult.data || []);
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
      setRoutineActivities((previous) => [...new Set([...ESSENTIAL_ROUTINE, ...previous, ...result.data.map((entry) => entry.activity)])]);
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
      await axios.put(`${API_BASE}/users/me/routine-check-in-status`, { date: routineDate, dismissed: false }, headers);
      localStorage.setItem(`orbit_routine_done_or_dismissed_${user.id}_${routineDate}`, "saved");
      localStorage.setItem(`last_routine_completed_date_${user.id}`, routineDate);
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
        const result = await axios.post(`${API_BASE}/signup`, credentials);
        const accessToken = result.data.access_token;
        if (!accessToken) throw new Error("The server did not return an onboarding session.");
        localStorage.setItem("token", accessToken);
        window.history.replaceState({}, "", "/onboarding");
        setToken(accessToken);
        return;
      }
      const result = await axios.post(`${API_BASE}/login`, credentials);
      const accessToken = result.data.access_token;
      if (!accessToken) throw new Error("The server did not return a session token.");
      localStorage.setItem("token", accessToken);
      window.history.replaceState({}, "", "/dashboard");
      setToken(accessToken);
    } catch (error) {
      setAuthError(error.response?.data?.detail || error.message || "Unable to sign in. Check your details and try again.");
    } finally {
      setLoading(false);
    }
  };

  const addRoutineActivity = (activity) => {
    if (activity === "custom") {
      const slug = customRoutineName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      if (!slug) return setNotice("Name your custom activity first.");
      const key = `custom_${slug}`;
      setRoutineActivities((previous) => previous.includes(key) ? previous : [...previous, key]);
      setRoutineTimes((previous) => ({ ...previous, [key]: previous[key] || "" }));
      setCustomRoutineName("");
      return;
    }
    setRoutineActivities((previous) => previous.includes(activity) ? previous : [...previous, activity]);
  };

  const dismissRoutineForToday = () => {
    if (!user) return;
    localStorage.setItem(`orbit_routine_done_or_dismissed_${user.id}_${new Date().toISOString().slice(0, 10)}`, "dismissed");
    localStorage.setItem(`last_routine_completed_date_${user.id}`, new Date().toISOString().slice(0, 10));
    axios.put(`${API_BASE}/users/me/routine-check-in-status`, { date: new Date().toISOString().slice(0, 10), dismissed: true }, headers)
      .then((result) => setUser((previous) => ({ ...previous, last_routine_completed_date: result.data.last_routine_completed_date })))
      .catch(() => { /* Keep the local marker for offline use. */ });
    setPage("dashboard");
  };

  const handlePasswordReset = async (event) => {
    event.preventDefault();
    setAuthError("");
    setLoading(true);
    try {
      if (!resetRequested) {
        await axios.post(`${API_BASE}/password-reset/request`, { email: resetForm.email });
        setResetEmailSent(true);
        setNotice("A reset link has been sent to your email. Please check your inbox.");
      } else {
        if (resetForm.newPassword !== resetForm.confirmPassword) throw new Error("Passwords do not match.");
        await axios.post(`${API_BASE}/password-reset/confirm`, { token: resetForm.token, new_password: resetForm.newPassword });
        setNotice("Password reset. Sign in with your new password.");
        window.history.replaceState({}, "", "/login");
        setAuthMode("login");
        setResetRequested(false);
        setResetForm({ email: "", token: "", newPassword: "", confirmPassword: "" });
      }
    } catch (error) {
      setAuthError(error.response?.data?.detail || "We could not complete the password reset. Please try again.");
    } finally { setLoading(false); }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken("");
    setUser(null);
    setTasks([]);
    setPage("dashboard");
    window.history.replaceState({}, "", "/login");
    setAuthMode("login");
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
      const result = await axios.post(`${API_BASE}/tasks/`, { title: form.title, start_time: start.toISOString(), end_time: endWindow.toISOString(), duration_minutes: durationMinutes, priority: form.priority, task_difficulty: form.taskDifficulty || null, current_energy_level: Number(form.currentEnergy || 5), current_stress_level: Number(form.currentStress || 5) }, headers);
      const task = result.data;
      setTasks((previous) => [task, ...previous]);
      scheduleNativeNotifications(task);
      setForm({ title: "", start: "", end: "", durationHours: "", durationMinutes: "", priority: "medium", taskDifficulty: "", currentEnergy: String(dailyCheckIn?.energy_level ?? 5), currentStress: String(dailyCheckIn?.stress_level ?? 5) });
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
    setEditDifficulty(task.task_difficulty || "medium");
    setRescheduleTime(dateTimeLocal(task.scheduled_time));
    setRescheduleEndTime(dateTimeLocal(task.deadline || task.expected_end_time));
  };

  const openTaskDetail = async (task) => {
    setTaskDetail({ task, loading: true });
    try {
      const result = await axios.get(`${API_BASE}/tasks/${task.id}/insight`, headers);
      setTaskDetail(result.data);
    } catch {
      setTaskDetail({ task, energy_required: task.current_energy_level ?? null, energy_available: task.current_energy_level != null ? (dailyCheckIn?.energy_level ?? null) : null, stress_level: task.current_stress_level ?? null, completion_probability: 65, recommendation: "Orbit is still learning your current workload. Keep this task focused and review it after completion." });
    }
  };

  const updateTask = async (event) => {
    event?.preventDefault();
    if (!selectedTask) return;
    if (response === "rescheduled" && (!rescheduleTime || !rescheduleEndTime)) return setNotice("Choose a new available start and end window before rescheduling.");
    try {
      const result = await axios.put(`${API_BASE}/tasks/${selectedTask.id}/respond`, null, {
        params: { user_response: response, notes, reschedule_time: response === "rescheduled" ? new Date(rescheduleTime).toISOString() : null, reschedule_end_time: response === "rescheduled" ? new Date(rescheduleEndTime).toISOString() : null },
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
      await loadTasks();
      await loadCoaching();
    } catch (error) {
      setNotice(error.response?.data?.detail || "Task update failed. Please try again.");
    }
  };

  const saveWrapUp = async () => {
    try {
      await axios.post(`${API_BASE}/users/me/daily-review`, {
        routine_status: routineReview,
        notes: wrapUpNotes,
        client_time: new Date().toISOString(),
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      }, headers);
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem(`orbit_daily_review_${user.id}_${today}`, "saved");
      setWrapUpOpen(false);
      setNotice("Daily wrap-up saved. Orbit will learn from what actually happened today.");
      await loadCoaching();
    } catch (error) {
      setNotice(error.response?.data?.detail || "Could not save the daily wrap-up.");
    }
  };

  const applyPreset = (title, minutes) => {
    const start = new Date();
    setForm({ title, start: dateTimeLocal(start), end: dateTimeLocal(new Date(start.getTime() + (minutes * 2) * 60000)), durationHours: String(Math.floor(minutes / 60)), durationMinutes: String(minutes % 60), priority: "medium", taskDifficulty: "", currentEnergy: String(dailyCheckIn?.energy_level ?? 5), currentStress: String(dailyCheckIn?.stress_level ?? 5) });
    setPage("schedule");
  };

  const completeOnboarding = async () => {
    setLoading(true);
    try {
      const selectedRoutineTimes = Object.fromEntries(Object.entries(onboardingActivities)
        .filter(([, selected]) => selected)
        .map(([activity]) => [activity, routineTimes[activity]]));
      if (Object.values(selectedRoutineTimes).some((time) => !time)) {
        setNotice("Choose a time for each routine activity you selected.");
        return;
      }
      const profile = await axios.post(`${API_BASE}/users/me/onboarding`, {
        name: profileForm.name,
        date_of_birth: profileForm.date_of_birth ? `${profileForm.date_of_birth}T00:00:00Z` : null,
        use_case: profileForm.use_case,
        study_hours: Number(profileForm.study_hours || 0), work_hours: Number(profileForm.work_hours || 0),
        sleep_hours: Number(profileForm.sleep_hours || 0), energy_level: Number(profileForm.energy_level || 5),
        routine_date: routineDate, routine_times: selectedRoutineTimes,
      }, headers);
      setUser(profile.data.user);
      setPage("dashboard");
      window.history.replaceState({}, "", "/dashboard");
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
        daily_free_hours: accountForm.daily_free_hours === "" ? null : Number(accountForm.daily_free_hours),
      }, headers);
      const dailyResult = await axios.put(`${API_BASE}/users/me/dynamic-data/latest`, {
        study_hours: Number(accountForm.study_hours || 0), work_hours: Number(accountForm.work_hours || 0),
        sleep_hours: Number(accountForm.sleep_hours || 0), exercise_minutes: Number(accountForm.exercise_minutes || 0),
        water_goal: Number(accountForm.water_goal || 0),
        energy_level: dailyCheckIn?.energy_level ?? 0,
        stress_level: dailyCheckIn?.stress_level ?? 0, mood: dailyCheckIn?.mood || null,
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
      <section className="auth-hero"><div className="brand auth-brand">orbit<span>day</span></div><span className="brand-mark">◈</span><p className="eyebrow">YOUR PERSONAL OPERATING SYSTEM</p><h1>Make room for what matters.</h1><p>Plan focused days, learn from your routine, and build a life that feels intentional.</p><div className="hero-points"><span>✓ Private account history</span><span>✓ Adaptive coaching</span><span>✓ Thoughtful reminders</span></div></section>
      <section className="auth-panel"><div className="auth-card"><h2>{authMode === "login" ? "Welcome back" : authMode === "signup" ? "Create your space" : "Reset your password"}</h2><p>{authMode === "login" ? "Sign in to continue your routine." : authMode === "signup" ? "Start with the essentials, then we’ll set up your routine." : resetRequested ? "Choose a new password for your account." : resetEmailSent ? "A reset link has been sent to your email. Please check your inbox." : isForgotPassword ? "We’ll email a secure reset link to your account." : "This reset link is missing or invalid. Request a new link from Forgot password."}</p>{notice && <div className="notice success">{notice}</div>}{authError && <div className="notice error">{authError}</div>}{authMode === "reset" ? (resetRequested ? <form onSubmit={handlePasswordReset}><label>New password<input type="password" minLength="8" value={resetForm.newPassword} onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })} placeholder="At least 8 characters" required autoFocus /></label><label>Confirm new password<input type="password" minLength="8" value={resetForm.confirmPassword} onChange={(e) => setResetForm({ ...resetForm, confirmPassword: e.target.value })} placeholder="Type it again" required /></label><button className="primary-button" disabled={loading}>{loading ? "Please wait…" : "Save new password"}</button></form> : isForgotPassword && !resetEmailSent ? <form onSubmit={handlePasswordReset}><label>Email address<input type="email" value={resetForm.email} onChange={(e) => setResetForm({ ...resetForm, email: e.target.value })} placeholder="you@example.com" required autoFocus /></label><button className="primary-button" disabled={loading}>{loading ? "Please wait…" : "Send reset link"}</button></form> : <button className="text-button" onClick={() => { window.history.pushState({}, "", "/forgot-password"); setAuthMode("reset"); setResetEmailSent(false); setAuthError(""); }}>Request a new reset link</button>) : <form onSubmit={handleAuth}>{authMode === "signup" && <label>Your name<input value={credentials.name} onChange={(e) => setCredentials({ ...credentials, name: e.target.value })} placeholder="What should we call you?" required autoFocus /></label>}<label>Email address<input type="email" value={credentials.email} onChange={(e) => setCredentials({ ...credentials, email: e.target.value })} placeholder="you@example.com" required autoFocus={authMode === "login"} /></label><label>Password<input type="password" minLength="6" value={credentials.password} onChange={(e) => setCredentials({ ...credentials, password: e.target.value })} placeholder="At least 6 characters" required /></label><button className="primary-button" disabled={loading}>{loading ? "Please wait…" : authMode === "login" ? "Sign in" : "Continue to setup"}</button></form>}{authMode === "login" && <button className="text-button" onClick={() => { window.history.pushState({}, "", "/forgot-password"); setAuthMode("reset"); setAuthError(""); setNotice(""); setResetEmailSent(false); }}>Forgot password?</button>}<button className="text-button" onClick={() => { const nextMode = authMode === "login" ? "signup" : "login"; window.history.pushState({}, "", `/${nextMode}`); setAuthMode(nextMode); setAuthError(""); setNotice(""); setResetRequested(false); setResetEmailSent(false); }}>{authMode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button></div></section>
    </main>
  );

  if (user && !user.onboarding_complete) {
    const roleQuestion = profileForm.use_case === "student" ? "How many hours do you study on a typical day?" : "How many hours do you work on a typical day?";
    return <main className="onboarding-shell"><section className="onboarding-card"><div className="brand">orbit<span>day</span></div><div className="progress"><i style={{ width: `${((onboardingStep + 1) / 4) * 100}%` }} /></div><p className="eyebrow">YOUR INITIAL SETUP · {onboardingStep + 1} OF 4</p>{notice && <div className="notice error">{notice}</div>}{onboardingStep === 0 && <><h1>Let’s make this feel personal.</h1><p>We’ll use this only to tailor your daily workspace.</p><label>Your name<input autoFocus value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} placeholder="What should we call you?" /></label><label>Date of birth <span>(optional)</span><input type="date" value={profileForm.date_of_birth} onChange={(e) => setProfileForm({ ...profileForm, date_of_birth: e.target.value })} /></label></>}{onboardingStep === 1 && <><h1>What does your day revolve around?</h1><p>Your answer shapes the language and suggestions you see.</p><div className="role-options">{[["student", "I’m studying", "Plan learning and revision"], ["professional", "I’m working", "Protect focused work time"], ["personal", "Personal goals", "Build a healthier routine"]].map(([value, title, copy]) => <button key={value} className={profileForm.use_case === value ? "selected" : ""} onClick={() => setProfileForm({ ...profileForm, use_case: value })}><b>{title}</b><small>{copy}</small></button>)}</div></>}{onboardingStep === 2 && <><h1>Set your core routine.</h1><p>Choose the anchors that shape most days. Add optional activities if they matter to your plan.</p><div className="onboarding-routine">{[["wake_up", "Wake up", true], ["work_start", "Work / college starts", true], ["sleep", "Sleep", true], ["exercise", "Exercise", false], ["study", "Study", false], ["lunch", "Lunch", false], ["dinner", "Dinner", false]].map(([key, label, core]) => <div className="onboarding-routine-row" key={key}><button type="button" className={`toggle ${onboardingActivities[key] ? "on" : ""}`} disabled={core} onClick={() => setOnboardingActivities({ ...onboardingActivities, [key]: !onboardingActivities[key] })} aria-label={`Toggle ${label}`}><i /></button><span>{label}{core ? " · core" : ""}</span>{onboardingActivities[key] && <input type="time" value={routineTimes[key]} onChange={(e) => setRoutineTimes({ ...routineTimes, [key]: e.target.value })} required />}</div>)}</div></>}{onboardingStep === 3 && <><h1>One last check-in.</h1><p>This gives your first coaching suggestion a useful starting point.</p><label>{roleQuestion}<input type="number" min="0" max="24" value={profileForm.use_case === "student" ? profileForm.study_hours : profileForm.work_hours} onChange={(e) => setProfileForm({ ...profileForm, [profileForm.use_case === "student" ? "study_hours" : "work_hours"]: e.target.value })} placeholder="Hours" /></label><div className="two-column"><label>Average sleep<input type="number" min="0" max="24" value={profileForm.sleep_hours} onChange={(e) => setProfileForm({ ...profileForm, sleep_hours: e.target.value })} placeholder="Hours" /></label><label>Energy today (1–10)<input type="number" min="1" max="10" value={profileForm.energy_level} onChange={(e) => setProfileForm({ ...profileForm, energy_level: e.target.value })} /></label></div></>}{onboardingStep < 3 ? <button className="primary-button" disabled={onboardingStep === 0 && !profileForm.name.trim()} onClick={() => { setNotice(""); setOnboardingStep(onboardingStep + 1); }}>Continue</button> : <button className="primary-button" disabled={loading} onClick={completeOnboarding}>{loading ? "Creating your space…" : "Open my workspace"}</button>}</section></main>;
  }

  const nav = [["dashboard", "Overview", "⌂"], ["schedule", "Plan", "+"], ["routine", "Routine", "◔"], ["coach", "Ask Orbit", "✦"], ["history", "History", "◷"], ["settings", "Settings", "⚙"]];
  return <div className="app-shell">
    <aside className="sidebar"><button className="brand brand-button" onClick={() => setPage("dashboard")} aria-label="Go to dashboard">orbit<span>day</span></button><p className="workspace-label">PERSONAL WORKSPACE</p><nav>{nav.map(([key, label, icon]) => <button key={key} className={page === key ? "nav-item active" : "nav-item"} onClick={() => { setPage(key); if (key === "routine") loadRoutine(); }}><span>{icon}</span>{label}</button>)}</nav><div className="sidebar-bottom"><button className="user-chip" onClick={() => setPage("settings")} title="Open profile"><div>{(user?.name || user?.email || "U")[0].toUpperCase()}</div><span>{user?.name || user?.email}</span></button><button className="nav-item logout" onClick={logout}><span>↪</span>Log out</button></div></aside>
    <main className="workspace"><header className="topbar"><div><p className="eyebrow">{page === "dashboard" ? "GOOD TO SEE YOU" : "YOUR PERSONAL SPACE"}</p><h1>{page === "dashboard" ? `Hello${user?.name ? `, ${user.name}` : ""}.` : page[0].toUpperCase() + page.slice(1)}</h1></div><div className="topbar-actions"><button className="secondary-button" onClick={() => setWrapUpOpen(true)}>Wrap up day</button><button className="notification-toggle" onClick={() => setMuted(!muted)}>{muted ? "Notifications off" : "Notifications on"}</button></div></header>{notice && <div className="notice success app-notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      {page === "dashboard" && <><section className="stats-grid"><article><span>ACTIVE PLANS</span><strong>{activeTasks.length}</strong><small>Ready for your attention</small></article><article><span>COMPLETED</span><strong>{completedCount}</strong><small>Tasks in your history</small></article><article><span>FOLLOW-THROUGH</span><strong>{completionRate}%</strong><small>Of logged tasks</small></article></section><section className="content-grid"><article className="panel wide"><div className="panel-heading"><div><p className="eyebrow">NEXT UP</p><h2>Your schedule</h2></div><button className="secondary-button" onClick={() => setPage("schedule")}>Plan a task</button></div>{activeTasks.length ? <div className="task-stack">{activeTasks.slice(0, 4).map((task) => <TaskRow key={task.id} task={task} onDetail={() => openTaskDetail(task)} onUpdate={() => openTask(task)} />)}</div> : <EmptyState title="A clear day starts with one plan." action="Schedule your first task" onClick={() => setPage("schedule")} />}</article><article className="panel coach-card"><p className="eyebrow">YOUR SECOND MIND</p><h2>Best next move</h2><p>{secondMind?.answer || coach}</p><hr /><p className="insight"><b>{secondMind?.suggested_time ? `Suggested time · ${secondMind.suggested_time}` : "Suggested next step"}</b>{insight}</p>{secondMind?.data_mode === "bootstrap" && <p className="ai-status">Starter guidance · personalized as you add routine and outcomes</p>}{secondMind?.data_mode === "blended" && <p className="ai-status">Learning from your routine · becoming more personal</p>}<button className="secondary-button coach-link" onClick={() => setPage("coach")}>Ask Orbit</button></article></section></>}
      {page === "schedule" && <section className="plan-layout"><article className="panel schedule-card"><p className="eyebrow">ADD TO YOUR DAY</p><h2>Plan a task window</h2><form className="task-form" onSubmit={createTask}><label>What do you want to do?<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Finish college assignment" required /></label><div className="two-column"><label>Available from<input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} required /></label><label>Deadline / end window<input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} required /></label></div><div className="duration-field"><span>Estimated effort</span><div><input type="number" min="0" max="720" value={form.durationHours} onChange={(e) => setForm({ ...form, durationHours: e.target.value })} placeholder="Hours" aria-label="Duration hours" /><input type="number" min="0" max="59" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} placeholder="Minutes" aria-label="Duration minutes" /></div><small>Orbit uses this duration to find a free slot inside your available window.</small></div><div className="two-column"><label>Current energy (1–10)<input type="range" min="1" max="10" value={form.currentEnergy} onChange={(e) => setForm({ ...form, currentEnergy: e.target.value })} /><small>{form.currentEnergy}/10</small></label><label>Current stress (1–10)<input type="range" min="1" max="10" value={form.currentStress} onChange={(e) => setForm({ ...form, currentStress: e.target.value })} /><small>{form.currentStress}/10</small></label></div>{scheduleAdvice && <div className={scheduleAdvice.has_conflict ? "schedule-advice warning" : "schedule-advice"}><b>Orbit’s scheduling note · {scheduleAdvice.completion_probability}% likely</b><span>{scheduleAdvice.message}</span>{scheduleAdvice.has_conflict && scheduleAdvice.suggested_start && <button type="button" className="secondary-button" onClick={() => setForm({ ...form, start: dateTimeLocal(scheduleAdvice.suggested_start) })}>Use {displayDate(scheduleAdvice.suggested_start)}</button>}</div>}<div className="two-column"><label>Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="high">High — do this first if plans overlap</option><option value="medium">Medium — normal priority</option><option value="low">Low — flexible</option></select></label><label>Difficulty <span>(for Orbit’s estimate)</span><select value={form.taskDifficulty} onChange={(e) => setForm({ ...form, taskDifficulty: e.target.value })}><option value="">Use profile default</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label></div><button className="primary-button">Add to plan</button></form></article><article className="panel"><p className="eyebrow">START FASTER</p><h2>Routine templates</h2><div className="preset-list">{[["Morning workout", 45], ["Deep work session", 90], ["Read and learn", 30], ["Daily reflection", 20]].map(([title, minutes]) => <button key={title} onClick={() => applyPreset(title, minutes)}><span>{title}</span><small>{minutes} min</small></button>)}</div></article></section>}
      {page === "routine" && <section className="routine-layout"><article className="panel"><p className="eyebrow">DAILY TIME CHECK-IN</p><h2>When did your day happen?</h2><p className="muted-copy routine-intro">Start with the essentials. Add only the activities that matter today—Orbit will protect them when planning.</p><form className="task-form" onSubmit={saveRoutine}><label>Day<input type="date" value={routineDate} onChange={(e) => changeRoutineDate(e.target.value)} required /></label><div className="routine-grid">{routineActivities.map((key) => { const [label, icon] = ROUTINE_META[key] || [key.replace(/^custom_/, "").replace(/_/g, " "), "✦"]; return <label key={key} className="routine-entry"><span className="routine-icon">{icon}</span><span>{label}</span><input type="time" value={routineTimes[key] || ""} onChange={(e) => setRoutineTimes({ ...routineTimes, [key]: e.target.value })} /></label>; })}</div><div className="routine-add"><select defaultValue="" onChange={(e) => { if (e.target.value) addRoutineActivity(e.target.value); e.target.value = ""; }}><option value="" disabled>+ Add more activities</option>{["exercise", "study", "wind_down"].filter((key) => !routineActivities.includes(key)).map((key) => <option key={key} value={key}>{ROUTINE_META[key][0]}</option>)}<option value="custom">Custom…</option></select><div className="routine-custom"><input value={customRoutineName} onChange={(e) => setCustomRoutineName(e.target.value)} placeholder="Custom activity name" /><button type="button" className="secondary-button" onClick={() => addRoutineActivity("custom")}>Add</button></div></div><div className="routine-actions"><button type="button" className="text-button" onClick={dismissRoutineForToday}>Do this later</button><button className="primary-button" disabled={routineLoading}>{routineLoading ? "Saving routine…" : "Save today’s times"}</button></div></form></article><article className="panel routine-help"><p className="eyebrow">WHY THIS MATTERS</p><h2>Better timing, less effort</h2><p>Orbit needs only your major commitments—not a minute-by-minute diary—to find realistic task slots.</p><p className="muted-copy">Tasks and routine anchors together create the available time that Orbit schedules around.</p></article></section>}
      {page === "coach" && <section className="coach-layout"><aside className="panel coach-sessions"><button className="secondary-button" onClick={newCoachChat}>+ New chat</button><p className="eyebrow">PREVIOUS CHATS</p><div>{coachSessions.map((session) => <div key={session.id} className="coach-session-row"><button className={activeCoachSessionId === session.id ? "coach-session active" : "coach-session"} onClick={() => loadCoachMessages(session.id)}><b>{session.title}</b><small>{session.preview || "Start a conversation"} · {new Date(session.updated_at).toLocaleDateString()}</small></button><button className="delete-chat" onClick={() => deleteCoachChat(session.id)} aria-label={`Delete ${session.title}`} title="Delete chat">×</button></div>)}</div></aside><article className="panel coach-conversation"><p className="eyebrow">ORBIT, YOUR SECOND MIND</p><h2>Think through your day</h2><p className="muted-copy">Ask anything naturally. Orbit only suggests a time when you ask it to plan or schedule.</p><div className="message-stack">{!coachMessages.length && <div className="coach-message assistant">Hi—what would you like to think through?</div>}{coachMessages.map((message, index) => <div key={index} className={`coach-message ${message.role}`}>{message.text}</div>)}</div><form className="coach-form" onSubmit={askCoach}><input value={coachQuestion} onChange={(e) => setCoachQuestion(e.target.value)} placeholder="e.g. When should I study today?" maxLength="500" /><button className="primary-button" disabled={coachSending}>{coachSending ? "Thinking…" : "Ask Orbit"}</button></form></article><article className="panel coach-facts"><p className="eyebrow">TODAY’S REASONING</p><h2>What Orbit is using</h2><div className="settings-line"><span>Conversation</span><b>{secondMind?.ai_mode === "live" ? "Live AI" : ["schedule fallback", "schedule-aware"].includes(secondMind?.ai_mode) ? "Schedule-aware" : "Ready for a question"}</b></div><div className="settings-line"><span>Suggested focus time</span><b>{secondMind?.suggested_time || "Learning your routine"}</b></div><div className="settings-line"><span>Next-step priority</span><b>{secondMind?.priority || "Medium"}</b></div><p className="muted-copy">{secondMind?.reason || "Complete a few tasks and save routine times so Orbit can recognize your most useful hours."}</p></article></section>}
      {page === "history" && <section className="panel"><div className="panel-heading"><div><p className="eyebrow">SAVED TO YOUR ACCOUNT</p><h2>Activity history</h2></div><span className="count-pill">{historyTasks.length} records</span></div>{historyTasks.length ? <div className="history-table">{historyTasks.map((task) => <div key={task.id} className="history-row"><div><b>{task.title}</b><small>{displayDate(task.scheduled_time)}</small>{task.user_reason && <em>“{task.user_reason}”</em>}</div><span className={`status ${task.status}`}>{task.status}</span></div>)}</div> : <EmptyState title="Completed plans will live here." action="View your schedule" onClick={() => setPage("dashboard")} />}</section>}
      {page === "settings" && <section className="settings-grid"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">PROFILE</p><h2>About you</h2></div>{!profileEditing && <button className="secondary-button" onClick={() => setProfileEditing(true)}>Edit profile</button>}</div>{!profileEditing ? <div className="profile-summary"><div className="settings-line"><span>Name</span><b>{user?.name || "Not provided"}</b></div><div className="settings-line"><span>Email</span><b>{user?.email}</b></div><div className="settings-line"><span>Age</span><b>{user?.age || "Not provided"}</b></div><div className="settings-line"><span>Date of birth</span><b>{dateOnly(user?.date_of_birth) || "Not provided"}</b></div><div className="settings-line"><span>Gender</span><b>{user?.gender || "Not provided"}</b></div><div className="settings-line"><span>Primary focus</span><b>{user?.use_case || "Not provided"}</b></div><div className="settings-line"><span>Best focus period</span><b>{user?.preferred_focus_time || "Not provided"}</b></div><div className="settings-line"><span>Planning style</span><b>{user?.planning_style || "Not provided"}</b></div><div className="settings-line"><span>Daily screen time</span><b>{user?.daily_screen_time ? `${user.daily_screen_time} hours` : "Not provided"}</b></div><div className="settings-line"><span>Usual task difficulty</span><b>{user?.preferred_task_difficulty || "Not provided"}</b></div><p className="eyebrow profile-section-label">LATEST DAILY CHECK-IN</p>{dailyCheckIn ? <div className="checkin-grid"><span>Study <b>{dailyCheckIn.study_hours || 0}h</b></span><span>Work <b>{dailyCheckIn.work_hours || 0}h</b></span><span>Sleep <b>{dailyCheckIn.sleep_hours || 0}h</b></span><span>Workout <b>{dailyCheckIn.exercise_minutes || 0} min</b></span><span>Water goal <b>{dailyCheckIn.water_goal || 0}</b></span><span>Mood <b>{dailyCheckIn.mood || "Not provided"}</b></span><span>Energy <b>{dailyCheckIn.energy_level || 0}/10</b></span><span>Stress <b>{dailyCheckIn.stress_level || 0}/10</b></span></div> : <p className="muted-copy">No daily check-in saved yet.</p>}<p className="muted-copy">Your saved profile is locked. Select Edit profile to make changes.</p></div> : <form className="profile-form" onSubmit={saveProfile}><label>Name<input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} required /></label><label>Email address<input value={user?.email || ""} disabled /></label><div className="two-column"><label>Age<input type="number" min="1" max="120" value={accountForm.age} onChange={(e) => setAccountForm({ ...accountForm, age: e.target.value })} /></label><label>Date of birth<input type="date" value={accountForm.date_of_birth} onChange={(e) => setAccountForm({ ...accountForm, date_of_birth: e.target.value })} /></label></div><div className="two-column"><label>Gender<select value={accountForm.gender} onChange={(e) => setAccountForm({ ...accountForm, gender: e.target.value })}><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="non-binary">Non-binary</option><option value="other">Other</option></select></label><label>Primary focus<select value={accountForm.use_case} onChange={(e) => setAccountForm({ ...accountForm, use_case: e.target.value })}><option value="student">Studying</option><option value="professional">Professional work</option><option value="personal">Personal goals</option></select></label></div><details className="more-profile"><summary>More about you (optional)</summary><p>These answers help the planning model estimate realistic workload and completion chances.</p><div className="two-column"><label>Daily screen time (hours)<input type="number" min="0" max="24" step="0.5" value={accountForm.daily_screen_time} onChange={(e) => setAccountForm({ ...accountForm, daily_screen_time: e.target.value })} /></label><label>Usual task difficulty<select value={accountForm.preferred_task_difficulty} onChange={(e) => setAccountForm({ ...accountForm, preferred_task_difficulty: e.target.value })}><option value="">Choose difficulty</option><option value="easy">Mostly easy</option><option value="medium">Mostly medium</option><option value="hard">Mostly hard</option></select></label></div><div className="two-column"><label>When do you focus best?<select value={accountForm.preferred_focus_time} onChange={(e) => setAccountForm({ ...accountForm, preferred_focus_time: e.target.value })}><option value="">Choose a time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option><option value="varies">It varies</option></select></label><label>How do you like to plan?<select value={accountForm.planning_style} onChange={(e) => setAccountForm({ ...accountForm, planning_style: e.target.value })}><option value="">Choose a style</option><option value="structured">Structured schedule</option><option value="flexible">Flexible task list</option><option value="mixed">A mix of both</option></select></label></div></details><details className="more-profile" open><summary>Daily baseline</summary><p>These values keep the editable profile in sync with your latest daily check-in.</p><div className="two-column"><label>Daily study hours<input type="number" min="0" max="24" step="0.5" value={accountForm.study_hours} onChange={(e) => setAccountForm({ ...accountForm, study_hours: e.target.value })} /></label><label>Daily work hours<input type="number" min="0" max="24" step="0.5" value={accountForm.work_hours} onChange={(e) => setAccountForm({ ...accountForm, work_hours: e.target.value })} /></label></div><div className="two-column"><label>Average sleep (hours)<input type="number" min="0" max="24" step="0.5" value={accountForm.sleep_hours} onChange={(e) => setAccountForm({ ...accountForm, sleep_hours: e.target.value })} /></label><label>Daily workout (minutes)<input type="number" min="0" max="1440" value={accountForm.exercise_minutes} onChange={(e) => setAccountForm({ ...accountForm, exercise_minutes: e.target.value })} /></label></div><div className="two-column"><label>Water goal<input type="number" min="0" step="0.1" value={accountForm.water_goal} onChange={(e) => setAccountForm({ ...accountForm, water_goal: e.target.value })} /></label><label>Baseline energy (0–10)<input type="number" min="0" max="10" value={accountForm.energy_level} onChange={(e) => setAccountForm({ ...accountForm, energy_level: e.target.value })} /></label></div><label>Baseline stress (0–10)<input type="number" min="0" max="10" value={accountForm.stress_level} onChange={(e) => setAccountForm({ ...accountForm, stress_level: e.target.value })} /></label></details><div className="profile-actions"><button type="button" className="secondary-button" onClick={() => setProfileEditing(false)}>Cancel</button><button className="primary-button" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save profile"}</button></div></form>}</article><article className="panel"><p className="eyebrow">NOTIFICATIONS</p><h2>Stay in control</h2><div className="settings-line"><span>Task reminders</span><button className={muted ? "toggle" : "toggle on"} onClick={() => setMuted(!muted)}><i /></button></div><p className="muted-copy">Turn reminders on to receive start and end alerts for scheduled tasks.</p></article></section>}
    </main>
    {selectedTask && <div className="modal-backdrop" onMouseDown={() => setSelectedTask(null)}><form className="modal" onSubmit={updateTask} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="close-button" onClick={() => setSelectedTask(null)}>×</button><p className="eyebrow">UPDATE TASK</p><h2>{selectedTask.title}</h2><p className="task-date">Scheduled: {displayDate(selectedTask.scheduled_time)}</p><div className="response-options">{[["completed", "Completed"], ["rescheduled", "Reschedule"], ["skipped", "Skip"]].map(([key, label]) => <button type="button" key={key} className={response === key ? "selected" : ""} onClick={() => setResponse(key)}>{label}</button>)}</div>{response === "rescheduled" && <><div className="two-column"><label>Available from<input type="datetime-local" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} required /></label><label>Available until<input type="datetime-local" value={rescheduleEndTime} onChange={(e) => setRescheduleEndTime(e.target.value)} required /></label></div><small>Orbit keeps the same effort and finds a free slot inside this window.</small></>}<label>Reflection (optional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What helped or got in the way?" /></label><button type="submit" className="primary-button">{response === "rescheduled" ? "Find and reschedule" : "Save update"}</button></form></div>}
      {taskDetail && <div className="modal-backdrop" onMouseDown={() => setTaskDetail(null)}><section className="modal detail-modal" onMouseDown={(event) => event.stopPropagation()}><button className="close-button" onClick={() => setTaskDetail(null)}>×</button><p className="eyebrow">TASK DETAIL · ORBIT INSIGHT</p><h2>{taskDetail.task.title}</h2>{taskDetail.loading ? <p>Building a day-aware recommendation…</p> : <><div className="detail-grid"><span><b>Priority</b>{taskDetail.task.priority}</span><span><b>Window</b>{displayDate(taskDetail.task.scheduled_time)}</span><span><b>Estimated effort</b>{taskDetail.task.duration_minutes || "—"} min</span>{taskDetail.energy_required != null && <span><b>Energy</b>{taskDetail.energy_required}/10 needed · {taskDetail.energy_available}/10 available</span>}{taskDetail.stress_level != null && <span><b>Stress</b>{taskDetail.stress_level}/10</span>}<span><b>Completion probability</b>{taskDetail.completion_probability}%</span></div><div className="schedule-advice"><b>Orbit’s recommendation</b><span>{taskDetail.recommendation}</span></div></>}<button className="secondary-button" onClick={() => { setTaskDetail(null); openTask(taskDetail.task); }}>Update task</button></section></div>}
    {wrapUpOpen && <div className="modal-backdrop" onMouseDown={() => setWrapUpOpen(false)}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="close-button" onClick={() => setWrapUpOpen(false)}>×</button><p className="eyebrow">END-OF-DAY CHECK-IN</p><h2>How did your routine go?</h2><p className="muted-copy">Confirm what really happened so Orbit can make better plans tomorrow. Update any remaining task from your schedule when you are ready.</p><div className="response-options">{[["followed", "Followed"], ["partly_followed", "Partly followed"], ["not_followed", "Not followed"]].map(([key, label]) => <button key={key} className={routineReview === key ? "selected" : ""} onClick={() => setRoutineReview(key)}>{label}</button>)}</div><label>What changed? <span>(optional)</span><textarea value={wrapUpNotes} onChange={(e) => setWrapUpNotes(e.target.value)} placeholder="Anything skipped, moved, or unexpectedly tiring?" /></label><button className="primary-button" onClick={saveWrapUp}>Save today’s review</button></section></div>}
  </div>;
}

function TaskRow({ task, onDetail, onUpdate }) { return <article className="task-row" role="button" tabIndex="0" onClick={onDetail} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onDetail(); }}><span className="task-icon">◷</span><span className="task-copy"><b>{task.title}</b><small>{displayDate(task.scheduled_time)}{task.expected_end_time ? ` — ${new Date(task.expected_end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</small></span><span className={`priority ${task.priority || "medium"}`}>{task.priority || "medium"}</span><button type="button" className="task-action" onClick={(event) => { event.stopPropagation(); onUpdate(); }}>Update →</button></article>; }
function EmptyState({ title, action, onClick }) { return <div className="empty-state"><div>✦</div><p>{title}</p><button className="secondary-button" onClick={onClick}>{action}</button></div>; }

export default App;
