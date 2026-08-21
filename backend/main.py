from datetime import datetime, timedelta
from typing import Optional
import os
import urllib.error
import urllib.request
from dotenv import load_dotenv

# Local development reads backend/.env; production platforms provide the same
# values as environment variables. Never put API keys in the frontend.
load_dotenv()

from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    Header,
    Query,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session
from sqlalchemy import or_, case
import hashlib
import hmac
import secrets
import base64
import json

from database import engine, Base, get_db, migrate_legacy_schema, SessionLocal
from models import User, Task, DynamicUserData, TimeEntry
from ml_helper import predict_task_insights


# ============================================================
# DATABASE INITIALIZATION
# ============================================================

Base.metadata.create_all(bind=engine)
migrate_legacy_schema()


# ============================================================
# FASTAPI
# ============================================================

app = FastAPI()

origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "").split(",")
    if origin.strip()
] + [
    "https://ai-daily-planer.vercel.app",
    "https://ai-daily-planer-git-main-friends24.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # ya testing ke liye ["*"] bhi rakh sakte hain
    # Accept Vercel preview and production aliases for this project without
    # opening credentialed API access to arbitrary websites.
    allow_origin_regex=r"https://ai-daily-planer(?:-[a-z0-9-]+)?\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# PASSWORD HASHING
# ============================================================

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)

    key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        120000,
    )

    return (
        base64.b64encode(salt).decode()
        + "$"
        + base64.b64encode(key).decode()
    )


def verify_password(password: str, stored_password: str) -> bool:
    try:
        salt_b64, key_b64 = stored_password.split("$")

        salt = base64.b64decode(salt_b64)
        stored_key = base64.b64decode(key_b64)

        new_key = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            120000,
        )

        return hmac.compare_digest(
            stored_key,
            new_key
        )

    except Exception:
        return False


def verify_legacy_password(password: str, stored_password: Optional[str]) -> bool:
    """Supports legacy records only until the startup migration clears them."""
    return bool(stored_password) and hmac.compare_digest(password, stored_password)


def migrate_legacy_passwords() -> None:
    """Hash and remove historic plain-text passwords exactly once."""
    db = SessionLocal()
    try:
        legacy_users = db.query(User).filter(User.hashed_password.isnot(None)).all()
        changed = False
        for user in legacy_users:
            if not user.password_hash:
                user.password_hash = hash_password(user.hashed_password)
            # Never retain the legacy plain-text value after a hash exists.
            user.hashed_password = None
            changed = True
        if changed:
            db.commit()
    finally:
        db.close()


migrate_legacy_passwords()


# ============================================================
# SIMPLE JWT-LIKE TOKEN
# ============================================================
#
# For the capstone MVP we keep authentication self-contained.
# The token contains user ID and expiry and is signed with a
# secret generated when the server starts.
#
# ============================================================

TOKEN_SECRET = os.getenv("TOKEN_SECRET") or hashlib.sha256(
    os.environ["DATABASE_URL"].encode("utf-8")
).hexdigest()


def create_token(user_id: int) -> str:
    payload = {
        "user_id": user_id,
        "exp": int(
            (datetime.utcnow() + timedelta(days=7)).timestamp()
        ),
    }

    payload_text = json.dumps(
        payload,
        separators=(",", ":")
    )

    encoded = base64.urlsafe_b64encode(
        payload_text.encode()
    ).decode()

    signature = hmac.new(
        TOKEN_SECRET.encode(),
        encoded.encode(),
        hashlib.sha256,
    ).hexdigest()

    return f"{encoded}.{signature}"


def decode_token(token: str) -> dict:
    try:
        encoded, signature = token.split(".", 1)

        expected_signature = hmac.new(
            TOKEN_SECRET.encode(),
            encoded.encode(),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(
            signature,
            expected_signature
        ):
            raise ValueError("Invalid token")

        payload = json.loads(
            base64.urlsafe_b64decode(
                encoded.encode()
            ).decode()
        )

        if payload["exp"] < int(
            datetime.utcnow().timestamp()
        ):
            raise ValueError("Token expired")

        return payload

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token",
        )


def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Authorization header missing",
        )

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization format",
        )

    token = authorization.replace(
        "Bearer ",
        "",
        1
    ).strip()

    payload = decode_token(token)

    user = db.query(User).filter(
        User.id == payload["user_id"]
    ).first()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="User not found",
        )

    return user


# ============================================================
# PYDANTIC MODELS
# ============================================================

class SignupRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: Optional[str] = None
    username: Optional[str] = None
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    date_of_birth: Optional[datetime] = None
    use_case: Optional[str] = None
    preferred_focus_time: Optional[str] = None
    planning_style: Optional[str] = None
    daily_screen_time: Optional[float] = None
    preferred_task_difficulty: Optional[str] = None
    onboarding_complete: Optional[bool] = None


class DynamicDataRequest(BaseModel):
    study_hours: float = 0
    work_hours: float = 0
    exercise_minutes: float = 0
    sleep_hours: float = 0
    water_goal: float = 0
    mood: Optional[str] = None
    energy_level: float = 0
    stress_level: float = 0


class TaskCreateRequest(BaseModel):
    title: str
    start_time: datetime
    end_time: datetime
    duration_minutes: int = Field(gt=0, le=60 * 24 * 30)
    priority: str = "medium"
    use_suggested_slot: bool = False


class TimeEntryInput(BaseModel):
    activity: str
    occurred_at: datetime


class TimeEntriesRequest(BaseModel):
    entries: list[TimeEntryInput]


class CoachMessageRequest(BaseModel):
    message: str


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():
    return {
        "message": "AI Daily Life OS backend is running",
        "database": "PostgreSQL",
        "status": "healthy",
    }


# ============================================================
# SIGNUP
# ============================================================

@app.post("/signup")
def signup(
    data: Optional[SignupRequest] = None,
    username: Optional[str] = Query(None),
    password: Optional[str] = Query(None),
    email: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    final_email = (
        data.email
        if data
        else (email or username)
    )

    final_password = (
        data.password
        if data
        else password
    )

    if not final_email or not final_password:
        raise HTTPException(
            status_code=400,
            detail="Email and password are required",
        )

    final_email = final_email.strip().lower()

    if len(final_password) < 6:
        raise HTTPException(
            status_code=400,
            detail="Password must contain at least 6 characters",
        )

    existing_user = db.query(User).filter(
        User.email == final_email
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Account already exists",
        )

    user = User(
        email=final_email,
        username=final_email,
        password_hash=hash_password(final_password),
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "message": "Account created successfully",
        "user_id": user.id,
        "email": user.email,
    }


# ============================================================
# LOGIN
# ============================================================

@app.post("/login")
def login(
    data: Optional[LoginRequest] = None,
    username: Optional[str] = Query(None),
    password: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    final_identifier = (
        (data.email if data else None)
        or
        (data.username if data else None)
        or
        username
    )

    final_password = (
        (data.password if data else None)
        or
        password
    )

    if not final_identifier or not final_password:
        raise HTTPException(
            status_code=400,
            detail="Email/username and password are required",
        )

    identifier = final_identifier.strip().lower()

    user = db.query(User).filter(
        User.email == identifier
    ).first()

    password_is_valid = user and (
        verify_password(final_password, user.password_hash or "")
        or verify_legacy_password(final_password, user.hashed_password)
    )

    if not password_is_valid:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    needs_password_upgrade = not user.password_hash or bool(user.hashed_password)
    if not user.password_hash:
        user.password_hash = hash_password(final_password)
    if user.hashed_password:
        user.hashed_password = None
    if needs_password_upgrade:
        db.commit()

    token = create_token(user.id)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
        },
    }


# ============================================================
# CURRENT USER
# ============================================================

@app.get("/users/me")
def get_me(
    current_user: User = Depends(get_current_user),
):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name,
        "age": current_user.age,
        "gender": current_user.gender,
        "date_of_birth": current_user.date_of_birth,
        "use_case": current_user.use_case,
        "preferred_focus_time": current_user.preferred_focus_time,
        "planning_style": current_user.planning_style,
        "daily_screen_time": current_user.daily_screen_time,
        "preferred_task_difficulty": current_user.preferred_task_difficulty,
        "onboarding_complete": current_user.onboarding_complete,
    }


# ============================================================
# UPDATE PROFILE
# ============================================================

@app.put("/users/me")
def update_profile(
    data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if data.name is not None:
        current_user.name = data.name

    if data.age is not None:
        current_user.age = data.age

    if data.gender is not None:
        current_user.gender = data.gender

    if data.date_of_birth is not None:
        current_user.date_of_birth = data.date_of_birth

    if data.use_case is not None:
        current_user.use_case = data.use_case

    if data.preferred_focus_time is not None:
        current_user.preferred_focus_time = data.preferred_focus_time

    if data.planning_style is not None:
        current_user.planning_style = data.planning_style

    if data.daily_screen_time is not None:
        current_user.daily_screen_time = data.daily_screen_time

    if data.preferred_task_difficulty is not None:
        current_user.preferred_task_difficulty = data.preferred_task_difficulty

    if data.onboarding_complete is not None:
        current_user.onboarding_complete = data.onboarding_complete

    db.commit()
    db.refresh(current_user)

    return {
        "message": "Profile updated",
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "name": current_user.name,
            "age": current_user.age,
            "gender": current_user.gender,
            "date_of_birth": current_user.date_of_birth,
            "use_case": current_user.use_case,
            "preferred_focus_time": current_user.preferred_focus_time,
            "planning_style": current_user.planning_style,
            "daily_screen_time": current_user.daily_screen_time,
            "preferred_task_difficulty": current_user.preferred_task_difficulty,
            "onboarding_complete": current_user.onboarding_complete,
        },
    }


# ============================================================
# CREATE TASK
# ============================================================

ROUTINE_BLOCK_MINUTES = {
    "wake_up": 30, "breakfast": 30, "commute": 60, "work_start": 480,
    "lunch": 45, "study": 90, "exercise": 60, "chores": 45,
    "dinner": 45, "entertainment": 90, "social_time": 60,
    "wind_down": 45, "sleep": 480,
}


def occupied_schedule_blocks(
    user_id: int,
    available_from: datetime,
    deadline: datetime,
    db: Session,
) -> list[dict]:
    """Return planned task and routine blocks that overlap a requested window."""
    blocks = []
    planned_tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user_id,
            Task.status == "pending",
            Task.scheduled_time < deadline,
            Task.expected_end_time.isnot(None),
            Task.expected_end_time > available_from,
        )
        .order_by(Task.scheduled_time.asc())
        .all()
    )
    for planned in planned_tasks:
        blocks.append({"start": planned.scheduled_time, "end": planned.expected_end_time, "label": planned.title, "kind": "task"})

    routine_entries = (
        db.query(TimeEntry)
        .filter(
            TimeEntry.user_id == user_id,
            TimeEntry.occurred_at < deadline,
            TimeEntry.occurred_at >= available_from - timedelta(hours=12),
        )
        .all()
    )
    for entry in routine_entries:
        end = entry.occurred_at + timedelta(minutes=ROUTINE_BLOCK_MINUTES.get(entry.activity, 30))
        if end > available_from:
            blocks.append({"start": entry.occurred_at, "end": end, "label": entry.activity.replace("_", " "), "kind": "routine"})
    return sorted(blocks, key=lambda block: block["start"])


def find_free_task_slot(
    user_id: int,
    available_from: datetime,
    deadline: datetime,
    duration_minutes: int,
    db: Session,
) -> Optional[datetime]:
    """Return the first task-sized gap within a user's requested window."""
    candidate = available_from
    if candidate + timedelta(minutes=duration_minutes) > deadline:
        return None
    for block in occupied_schedule_blocks(user_id, available_from, deadline, db):
        if candidate + timedelta(minutes=duration_minutes) <= block["start"]:
            return candidate
        if block["end"] > candidate:
            candidate = block["end"]

    return candidate if candidate + timedelta(minutes=duration_minutes) <= deadline else None


@app.post("/tasks/schedule-advice")
def schedule_advice(
    data: TaskCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    available_from = data.start_time.replace(tzinfo=None)
    deadline = data.end_time.replace(tzinfo=None)
    requested_end = available_from + timedelta(minutes=data.duration_minutes)
    if deadline <= available_from or requested_end > deadline:
        raise HTTPException(status_code=400, detail="Duration must fit inside the selected window")

    conflicts = [
        block for block in occupied_schedule_blocks(current_user.id, available_from, requested_end, db)
        if block["start"] < requested_end and block["end"] > available_from
    ]
    suggestion = find_free_task_slot(current_user.id, available_from, deadline, data.duration_minutes, db)
    if not conflicts:
        return {"has_conflict": False, "message": "This time looks clear. You can keep this plan.", "suggested_start": available_from, "suggested_end": requested_end}
    labels = ", ".join(block["label"].title() for block in conflicts[:2])
    if suggestion:
        suggested_end = suggestion + timedelta(minutes=data.duration_minutes)
        return {
            "has_conflict": True,
            "message": f"This overlaps with {labels}. You can keep your time, or try the suggested slot.",
            "suggested_start": suggestion,
            "suggested_end": suggested_end,
            "conflicts": [{"label": block["label"], "kind": block["kind"]} for block in conflicts],
        }
    return {"has_conflict": True, "message": f"This overlaps with {labels}. No clear slot of this length was found before the deadline, so keep it only if you can move that activity.", "suggested_start": None, "suggested_end": None, "conflicts": [{"label": block["label"], "kind": block["kind"]} for block in conflicts]}

@app.post("/tasks/")
def create_task(
    data: Optional[TaskCreateRequest] = None,
    title: Optional[str] = Query(None),
    scheduled_time: Optional[datetime] = Query(None),
    expected_end_time: Optional[datetime] = None,
    priority: str = "medium",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if data:
        final_title = data.title.strip()
        available_from = data.start_time.replace(tzinfo=None)
        deadline = data.end_time.replace(tzinfo=None)
        duration_minutes = data.duration_minutes
        final_priority = data.priority
    else:
        final_title = (title or "").strip()
        available_from = scheduled_time.replace(tzinfo=None) if scheduled_time else None
        deadline = expected_end_time.replace(tzinfo=None) if expected_end_time else None
        duration_minutes = int((expected_end_time - scheduled_time).total_seconds() // 60) if scheduled_time and expected_end_time else None
        final_priority = priority

    if not final_title or not available_from:
        raise HTTPException(status_code=400, detail="Title and start time are required")
    if not deadline or deadline <= available_from:
        raise HTTPException(status_code=400, detail="End window must be after the start window")
    if not duration_minutes or duration_minutes <= 0:
        raise HTTPException(status_code=400, detail="Duration must be greater than zero")
    if available_from + timedelta(minutes=duration_minutes) > deadline:
        raise HTTPException(status_code=400, detail="Duration must fit inside the available time window")

    final_priority = final_priority.lower().strip()
    if final_priority not in {"low", "medium", "high"}:
        raise HTTPException(status_code=400, detail="Priority must be low, medium, or high")

    allocated_start = available_from
    if data and data.use_suggested_slot:
        allocated_start = find_free_task_slot(
            current_user.id, available_from, deadline, duration_minutes, db
        )
    if not allocated_start:
        raise HTTPException(
            status_code=409,
            detail="No free slot of that duration exists inside the selected window",
        )

    task = Task(
        user_id=current_user.id,
        title=final_title,
        message=final_title,
        scheduled_time=allocated_start,
        expected_end_time=allocated_start + timedelta(minutes=duration_minutes),
        deadline=deadline,
        duration_minutes=duration_minutes,
        status="pending",
        priority=final_priority,
    )

    db.add(task)
    db.commit()
    db.refresh(task)

    return {
        "id": task.id,
        "notification_id": task.id,
        "task_id": task.id,
        "title": task.title,
        "message": task.message,
        "scheduled_time": task.scheduled_time,
        "expected_end_time": task.expected_end_time,
        "start_time": task.scheduled_time,
        "end_time": task.deadline,
        "deadline": task.deadline,
        "duration_minutes": task.duration_minutes,
        "status": task.status,
        "priority": task.priority,
        "start_notified": task.start_notified,
        "end_notified": task.end_notified,
    }


# ============================================================
# GET USER TASKS
# ============================================================

@app.get("/notifications/")
def get_tasks(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tasks = (
        db.query(Task)
        .filter(Task.user_id == current_user.id)
        .order_by(
            Task.scheduled_time.desc(),
            case(
                (Task.priority == "high", 3),
                (Task.priority == "medium", 2),
                else_=1,
            ).desc(),
        )
        .all()
    )

    return [
        {
            "id": task.id,
            "notification_id": task.id,
            "task_id": task.id,
            "title": task.title,
            "message": task.message,
            "scheduled_time": task.scheduled_time,
            "expected_end_time": task.expected_end_time,
            "start_time": task.scheduled_time,
            "end_time": task.deadline,
            "deadline": task.deadline,
            "duration_minutes": task.duration_minutes,
            "status": task.status,
            "priority": task.priority,
            "user_reason": task.user_reason,
            "rescheduled_time": task.rescheduled_time,
            "start_notified": task.start_notified,
            "end_notified": task.end_notified,
        }
        for task in tasks
    ]


# ============================================================
# GET SINGLE TASK
# ============================================================

@app.get("/tasks/{task_id}")
def get_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(
            status_code=404,
            detail="Task not found",
        )

    return task_to_dict(task)


# ============================================================
# UPDATE TASK RESPONSE
# ============================================================

@app.put("/tasks/{task_id}/respond")
def respond_to_task(
    task_id: int,
    user_response: str,
    notes: Optional[str] = None,
    reschedule_time: Optional[datetime] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed_statuses = {
        "completed",
        "skipped",
        "rescheduled",
    }

    user_response = user_response.lower().strip()

    if user_response not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid task response",
        )

    task = db.query(Task).filter(
        Task.id == task_id,
        Task.user_id == current_user.id,
    ).first()

    if not task:
        raise HTTPException(
            status_code=404,
            detail="Task not found",
        )

    task.user_reason = notes

    if user_response == "rescheduled":
        if not reschedule_time:
            raise HTTPException(
                status_code=400,
                detail="New time is required for rescheduling",
            )

        duration = None
        if task.expected_end_time:
            duration = task.expected_end_time - task.scheduled_time

        task.rescheduled_time = reschedule_time
        task.scheduled_time = reschedule_time
        if duration and duration.total_seconds() > 0:
            task.expected_end_time = reschedule_time + duration

        # A rescheduled task is still unfinished. Keep it visible in the
        # active schedule and allow its notifications to fire again.
        task.status = "pending"
        task.start_notified = False
        task.end_notified = False
    else:
        task.status = user_response

    db.commit()
    db.refresh(task)

    return {
        "message": "Task response saved permanently",
        "task": task_to_dict(task),
    }


# ============================================================
# DYNAMIC USER DATA
# ============================================================

@app.post("/users/me/dynamic-data")
def save_dynamic_data(
    data: DynamicDataRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = DynamicUserData(
        user_id=current_user.id,
        study_hours=data.study_hours,
        work_hours=data.work_hours,
        exercise_minutes=data.exercise_minutes,
        sleep_hours=data.sleep_hours,
        water_goal=data.water_goal,
        mood=data.mood,
        energy_level=data.energy_level,
        stress_level=data.stress_level,
    )

    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "message": "Dynamic user data saved",
        "id": record.id,
    }


@app.put("/users/me/dynamic-data/latest")
def update_latest_dynamic_data(
    data: DynamicDataRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = (
        db.query(DynamicUserData)
        .filter(DynamicUserData.user_id == current_user.id)
        .order_by(DynamicUserData.recorded_at.desc())
        .first()
    )
    if not record:
        record = DynamicUserData(user_id=current_user.id)
        db.add(record)
    for field, value in data.model_dump().items():
        setattr(record, field, value)
    record.recorded_at = datetime.utcnow()
    db.commit()
    db.refresh(record)
    return {
        "study_hours": record.study_hours, "work_hours": record.work_hours,
        "exercise_minutes": record.exercise_minutes, "sleep_hours": record.sleep_hours,
        "water_goal": record.water_goal, "mood": record.mood,
        "energy_level": record.energy_level, "stress_level": record.stress_level,
        "recorded_at": record.recorded_at,
    }


@app.get("/users/me/dynamic-data/latest")
def get_latest_dynamic_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = (
        db.query(DynamicUserData)
        .filter(DynamicUserData.user_id == current_user.id)
        .order_by(DynamicUserData.recorded_at.desc())
        .first()
    )
    if not record:
        return None
    return {
        "study_hours": record.study_hours,
        "work_hours": record.work_hours,
        "exercise_minutes": record.exercise_minutes,
        "sleep_hours": record.sleep_hours,
        "water_goal": record.water_goal,
        "mood": record.mood,
        "energy_level": record.energy_level,
        "stress_level": record.stress_level,
        "recorded_at": record.recorded_at,
    }


# ============================================================
# DAILY ROUTINE TIME DATA
# ============================================================

ROUTINE_ACTIVITIES = {
    "wake_up", "breakfast", "commute", "work_start", "lunch", "study", "exercise",
    "chores", "dinner", "entertainment", "social_time", "wind_down", "sleep",
}


def time_entry_to_dict(entry: TimeEntry):
    return {
        "id": entry.id,
        "activity": entry.activity,
        "occurred_at": entry.occurred_at,
        "recorded_at": entry.recorded_at,
    }


@app.get("/users/me/time-entries")
def get_time_entries(
    date: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(TimeEntry).filter(TimeEntry.user_id == current_user.id)
    if date:
        try:
            selected_day = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="date must use YYYY-MM-DD format")
        query = query.filter(
            TimeEntry.occurred_at >= datetime.combine(selected_day, datetime.min.time()),
            TimeEntry.occurred_at < datetime.combine(selected_day + timedelta(days=1), datetime.min.time()),
        )
    entries = query.order_by(TimeEntry.occurred_at.asc()).limit(100).all()
    return [time_entry_to_dict(entry) for entry in entries]


@app.post("/users/me/time-entries")
def save_time_entries(
    data: TimeEntriesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not data.entries:
        raise HTTPException(status_code=400, detail="Add at least one activity time")
    if len(data.entries) > len(ROUTINE_ACTIVITIES):
        raise HTTPException(status_code=400, detail="Too many activity entries")

    saved = []
    seen = set()
    for input_entry in data.entries:
        activity = input_entry.activity.strip().lower()
        if activity not in ROUTINE_ACTIVITIES:
            raise HTTPException(status_code=400, detail=f"Unsupported routine activity: {activity}")
        if activity in seen:
            raise HTTPException(status_code=400, detail="Each activity can be entered once per save")
        seen.add(activity)

        occurred_at = input_entry.occurred_at.replace(tzinfo=None)
        entry = db.query(TimeEntry).filter(
            TimeEntry.user_id == current_user.id,
            TimeEntry.activity == activity,
            TimeEntry.occurred_at == occurred_at,
        ).first()
        if not entry:
            entry = TimeEntry(user_id=current_user.id, activity=activity, occurred_at=occurred_at)
            db.add(entry)
        saved.append(entry)

    db.commit()
    for entry in saved:
        db.refresh(entry)
    return {"message": "Routine times saved", "entries": [time_entry_to_dict(entry) for entry in saved]}


# ============================================================
# AI COACH
# ============================================================

@app.get("/users/me/ai-coach")
def ai_coach(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tasks = db.query(Task).filter(
        Task.user_id == current_user.id
    ).all()
    latest_daily_data = (
        db.query(DynamicUserData)
        .filter(DynamicUserData.user_id == current_user.id)
        .order_by(DynamicUserData.recorded_at.desc())
        .first()
    )
    completed = [t for t in tasks if t.status == "completed"]
    skipped = [t for t in tasks if t.status == "skipped"]
    rescheduled = [t for t in tasks if t.rescheduled_time is not None]

    logged = len(completed) + len(skipped)

    if latest_daily_data and latest_daily_data.sleep_hours < 6:
        tip = (
            f"You logged {latest_daily_data.sleep_hours:g} hours of sleep. "
            "Keep today’s plan lighter and protect a recovery window."
        )
    elif latest_daily_data and latest_daily_data.stress_level >= 7:
        tip = (
            "Your latest check-in shows high stress. Start with one short, "
            "clear task before adding more to today’s schedule."
        )
    elif logged == 0:
        tip = (
            "Welcome! Schedule your first task and update "
            "its status. Your activity history will help "
            "generate personalized coaching."
        )
    else:
        completion_rate = (
            len(completed) / logged
        ) * 100

        successful_hours = {}
        for task in completed:
            hour = task.scheduled_time.hour
            successful_hours[hour] = successful_hours.get(hour, 0) + 1
        best_hour = max(successful_hours, key=successful_hours.get, default=None)

        if len(rescheduled) > len(completed):
            tip = (
                "You have rescheduled several tasks. Keep a smaller daily "
                "plan and leave buffer time between commitments."
            )
        elif best_hour is not None and successful_hours[best_hour] >= 2:
            tip = (
                f"Your best follow-through is around {best_hour:02d}:00. "
                "Reserve that time for your most important work."
            )
        elif completion_rate >= 80:
            tip = (
                f"🔥 Excellent consistency! Your completion "
                f"rate is {completion_rate:.0f}%. Keep protecting "
                f"your focused work periods."
            )

        elif completion_rate >= 50:
            tip = (
                f"⚖️ Your completion rate is "
                f"{completion_rate:.0f}%. Try prioritizing "
                f"important tasks during your highest-energy "
                f"periods."
            )

        else:
            tip = (
                f"💡 Your completion rate is "
                f"{completion_rate:.0f}%. Consider shorter "
                f"task blocks and realistic scheduling."
            )

    return {
        "tip": tip,
        "statistics": {
            "total_tasks": len(tasks),
            "completed": len(completed),
            "skipped": len(skipped),
            "rescheduled": len(rescheduled),
        },
    }


# ============================================================
# ADAPTIVE RECOMMENDATIONS
# ============================================================

def hour_label(hour: int) -> str:
    return datetime(2000, 1, 1, hour).strftime("%I %p").lstrip("0")


REAL_TASK_HISTORY_THRESHOLD = 7
REAL_ROUTINE_DAYS_THRESHOLD = 5


def bootstrap_profile(current_user: User) -> dict:
    """Synthetic prior for a new user; it is never written as user history."""
    focus_hour = {
        "morning": 9, "afternoon": 14, "evening": 19,
    }.get(current_user.preferred_focus_time or "")
    if focus_hour is None:
        focus_hour = {"student": 10, "professional": 9, "personal": 11}.get(
            current_user.use_case or "", 10
        )
    return {
        "focus_hour": focus_hour,
        "sleep_hours": 7.5,
        "work_hours": 8 if current_user.use_case == "professional" else 4 if current_user.use_case == "student" else 2,
        "exercise_minutes": 30,
        "energy": 6,
        "stress": 4,
        "block_minutes": 60 if current_user.planning_style == "structured" else 45,
    }


def build_second_mind_context(current_user: User, db: Session) -> dict:
    """Blend a temporary synthetic prior into real user signals until sufficient history exists."""
    tasks = db.query(Task).filter(Task.user_id == current_user.id).all()
    completed = [task for task in tasks if task.status == "completed"]
    prior = bootstrap_profile(current_user)
    latest_daily_data = (
        db.query(DynamicUserData)
        .filter(DynamicUserData.user_id == current_user.id)
        .order_by(DynamicUserData.recorded_at.desc())
        .first()
    )
    completed_by_hour = {}
    for task in completed:
        hour = task.scheduled_time.hour
        completed_by_hour[hour] = completed_by_hour.get(hour, 0) + 1
    learned_hour = max(completed_by_hour, key=completed_by_hour.get, default=None)

    routine_entries = (
        db.query(TimeEntry)
        .filter(TimeEntry.user_id == current_user.id, TimeEntry.activity == "wake_up")
        .order_by(TimeEntry.occurred_at.desc())
        .limit(30)
        .all()
    )
    wake_hour = round(sum(entry.occurred_at.hour for entry in routine_entries) / len(routine_entries)) if routine_entries else None
    routine_days = len({entry.occurred_at.date() for entry in routine_entries})

    task_confidence = min(len(completed) / REAL_TASK_HISTORY_THRESHOLD, 1)
    routine_confidence = min(routine_days / REAL_ROUTINE_DAYS_THRESHOLD, 1)
    timing_confidence = max(task_confidence, routine_confidence)
    real_focus_hour = learned_hour if task_confidence >= routine_confidence else (wake_hour + 1 if wake_hour is not None else None)
    suggested_hour = (
        round((prior["focus_hour"] * (1 - timing_confidence)) + (real_focus_hour * timing_confidence))
        if real_focus_hour is not None else prior["focus_hour"]
    )
    suggested_hour = max(0, min(23, suggested_hour))
    if timing_confidence >= 1:
        data_mode = "personalized"
        data_source = "Based on your own completed tasks and routine history."
    elif timing_confidence > 0:
        data_mode = "blended"
        data_source = "Blending your saved routine with a temporary starter profile while Orbit learns your pattern."
    else:
        data_mode = "bootstrap"
        data_source = "Using a temporary starter profile based on your onboarding preferences; no synthetic events are saved to your history."

    mood_value = (latest_daily_data.mood if latest_daily_data else "Neutral") or "Neutral"
    energy_value = latest_daily_data.energy_level if latest_daily_data else prior["energy"]
    stress_value = latest_daily_data.stress_level if latest_daily_data else prior["stress"]
    sleep_value = latest_daily_data.sleep_hours if latest_daily_data else prior["sleep_hours"]
    ml_input = {
        "sleep_hours": sleep_value,
        "work_hours": latest_daily_data.work_hours if latest_daily_data else prior["work_hours"],
        "screen_time_hours": current_user.daily_screen_time or 0,
        "exercise_minutes": latest_daily_data.exercise_minutes if latest_daily_data else prior["exercise_minutes"],
        "mood": {"happy": 0, "motivated": 1, "neutral": 2, "sad": 3, "stressed": 4}.get(str(mood_value).lower(), 2),
        "energy_level": 0 if energy_value <= 3 else 1 if energy_value <= 7 else 2,
        "stress_level": stress_value,
        "focus_level": max(1, min(10, round((energy_value * 0.7) + ((10 - stress_value) * 0.3)))),
        "task_difficulty": {"easy": 0, "medium": 1, "hard": 2}.get((current_user.preferred_task_difficulty or "medium").lower(), 1),
        "deadline_days_left": 1,
    }
    return {
        "model": predict_task_insights(ml_input),
        "completed_count": len(completed),
        "learned_hour": learned_hour,
        "learned_hour_samples": completed_by_hour.get(learned_hour, 0) if learned_hour is not None else 0,
        "wake_hour": wake_hour,
        "suggested_hour": suggested_hour,
        "data_mode": data_mode,
        "data_source": data_source,
        "history_progress": {"completed_tasks": len(completed), "routine_days": routine_days, "needed_completed_tasks": REAL_TASK_HISTORY_THRESHOLD, "needed_routine_days": REAL_ROUTINE_DAYS_THRESHOLD},
        "starter_block_minutes": prior["block_minutes"],
        "energy": energy_value,
        "stress": stress_value,
        "sleep": sleep_value,
    }


def second_mind_response(context: dict, request: str = "") -> dict:
    model = context["model"]
    priority = {"0": "low", "1": "medium", "2": "high"}.get(str(model.get("predicted_priority")), "medium")
    can_complete = str(model.get("expected_completion")) == "1"
    suggested_time = hour_label(context["suggested_hour"])
    rationale = context["data_source"]

    text = request.lower()
    recovery_needed = context["sleep"] < 6 or context["stress"] >= 7 or context["energy"] <= 3
    if any(word in text for word in ("rest", "break", "tired", "burnout", "sleep")) or recovery_needed:
        answer = (
            "Your current signals point to recovery first: take a 20-minute screen-free break, then choose one small task. "
            "Avoid scheduling demanding work until your energy is steadier."
        )
        suggested_time = "after a 20-minute break"
    elif any(word in text for word in ("when", "schedule", "time", "plan", "task", "study", "work")):
        block = "25 minutes" if not can_complete else f"{context['starter_block_minutes']} minutes"
        answer = f"Schedule your next {priority}-priority focus block at {suggested_time} for {block}. {rationale}"
    else:
        answer = (
            f"Right now I would protect {suggested_time} for your most important work and keep everything else lighter. "
            f"Your model assessment suggests a {priority}-priority next step. {rationale}"
        )
    return {
        "answer": answer,
        "suggested_time": suggested_time,
        "priority": priority,
        "completion_likely": can_complete,
        "reason": rationale,
        "data_mode": context["data_mode"],
        "history_progress": context["history_progress"],
        "model_insights": model if "error" not in model else None,
    }


def format_orbit_datetime(value: Optional[datetime]) -> str:
    """Return a compact, timezone-neutral timestamp for the model prompt."""
    return value.strftime("%a %d %b, %I:%M %p") if value else "not set"


def build_orbit_prompt(current_user: User, db: Session, question: str) -> str:
    """Build a bounded prompt from this user's actual plan and routine only."""
    now = datetime.now()
    upcoming_tasks = (
        db.query(Task)
        .filter(Task.user_id == current_user.id, Task.status.notin_(["completed", "skipped"]))
        .order_by(Task.scheduled_time.asc())
        .limit(20)
        .all()
    )
    recent_tasks = (
        db.query(Task)
        .filter(Task.user_id == current_user.id, Task.status.in_(["completed", "skipped"]))
        .order_by(Task.updated_at.desc())
        .limit(10)
        .all()
    )
    routine_entries = (
        db.query(TimeEntry)
        .filter(TimeEntry.user_id == current_user.id)
        .order_by(TimeEntry.occurred_at.desc())
        .limit(40)
        .all()
    )
    daily_data = (
        db.query(DynamicUserData)
        .filter(DynamicUserData.user_id == current_user.id)
        .order_by(DynamicUserData.recorded_at.desc())
        .first()
    )

    planned = "\n".join(
        f"- {task.title} | {task.priority} priority | planned {format_orbit_datetime(task.scheduled_time)}"
        f" | duration {task.duration_minutes or 'unspecified'} min | available until {format_orbit_datetime(task.deadline)}"
        for task in upcoming_tasks
    ) or "- No upcoming tasks have been planned."
    history = "\n".join(
        f"- {task.title} | {task.status} | scheduled {format_orbit_datetime(task.scheduled_time)}"
        for task in recent_tasks
    ) or "- No completed or skipped tasks yet."
    routine = "\n".join(
        f"- {entry.activity.replace('_', ' ')}: {format_orbit_datetime(entry.occurred_at)}"
        for entry in reversed(routine_entries)
    ) or "- No routine times have been saved yet."
    wellbeing = (
        f"sleep {daily_data.sleep_hours:g}h, energy {daily_data.energy_level:g}/10, "
        f"stress {daily_data.stress_level:g}/10, mood {daily_data.mood or 'not recorded'}"
        if daily_data else "No wellbeing check-in has been recorded."
    )

    return f"""You are Orbit, a warm, practical personal planning assistant. Reply naturally, as a thoughtful person—not as a generic chatbot.

Current local time: {format_orbit_datetime(now)}.
User: {current_user.name or 'there'}.

The following is private, real data from this user's account. Use it to answer accurately. Do not claim you completed, changed, or scheduled anything. If the needed information is absent, say so plainly and suggest the smallest helpful next step. Do not make up appointments, routines, facts, or times. Keep the answer to at most 140 words and use short paragraphs or bullets only when they improve clarity.

TODAY / UPCOMING PLAN:
{planned}

RECENT TASK OUTCOMES:
{history}

SAVED ROUTINE TIMES:
{routine}

LATEST WELLBEING CHECK-IN:
{wellbeing}

User question: {question}
"""


def ask_orbit_ai(prompt: str) -> str:
    """Call Gemini server-side and return its text, with no synthetic fallback."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Orbit AI is not configured yet. Add GEMINI_API_KEY to the backend environment and redeploy.",
        )

    # Render users commonly copy the REST resource name ("models/..."), while
    # this endpoint builds that path segment itself. Support both forms.
    preferred_model = os.getenv("ORBIT_AI_MODEL", "gemini-2.5-flash").strip().removeprefix("models/")
    model = preferred_model
    model_candidates = [preferred_model]
    if not model or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_" for character in model):
        raise HTTPException(status_code=503, detail="ORBIT_AI_MODEL must be a Gemini model ID, for example gemini-2.5-flash.")

    # Model availability can differ by API key, account, and rollout. Ask
    # Gemini which models this exact key can generate with, then choose a
    # current Flash model rather than failing just because an alias changed.
    try:
        models_request = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}",
            method="GET",
        )
        with urllib.request.urlopen(models_request, timeout=12) as models_response:
            available_models = json.loads(models_response.read().decode("utf-8")).get("models", [])
        generative_models = {
            item.get("name", "").removeprefix("models/")
            for item in available_models
            if "generateContent" in item.get("supportedGenerationMethods", [])
        }
        if not generative_models:
            raise HTTPException(
                status_code=503,
                detail="This Gemini API key has no text-generation models enabled. Create an unrestricted key in Google AI Studio and verify its project has Gemini API access.",
            )
        # Try the requested/current IDs first, then any other supported Flash
        # model. This keeps Orbit available when one Gemini model is busy.
        safe_flash_models = sorted(
            candidate for candidate in generative_models
            if "flash" in candidate and not any(
                excluded in candidate for excluded in ("audio", "image", "tts", "live")
            )
        )
        preferred_candidates = [
            preferred_model, "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash",
        ] + list(reversed(safe_flash_models))
        model_candidates = []
        for candidate in preferred_candidates:
            if candidate in generative_models and candidate not in model_candidates:
                model_candidates.append(candidate)
        if model_candidates:
            model = model_candidates[0]
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        # The generation call below gives the user the final actionable error.
        print(f"Orbit AI model discovery failed; using configured model: {error}")

    print(f"Orbit AI candidate Gemini models: {', '.join(model_candidates)}")
    payload = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        # Keep the configuration portable across Gemini model generations.
        "generationConfig": {"maxOutputTokens": 350},
    }).encode("utf-8")
    last_busy_diagnostic = ""
    try:
        body = None
        for index, model in enumerate(model_candidates):
            request = urllib.request.Request(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=25) as response:
                    body = json.loads(response.read().decode("utf-8"))
                print(f"Orbit AI answered with Gemini model: {model}")
                break
            except urllib.error.HTTPError as error:
                diagnostic = error.read().decode("utf-8", errors="replace")[:1000]
                if error.code == 503 and index < len(model_candidates) - 1:
                    last_busy_diagnostic = diagnostic
                    print(f"Orbit AI model {model} is busy; trying the next available model")
                    continue
                raise
        if body is None and last_busy_diagnostic:
            raise HTTPException(
                status_code=503,
                detail="Gemini is temporarily busy across the available models for this key. Please try again in a minute.",
            )
    except urllib.error.HTTPError as error:
        # Log Gemini's diagnostic body on Render, but return only a safe and
        # actionable diagnostic to the signed-in user. Gemini never needs to
        # echo the API key, but redact it defensively before returning text.
        diagnostic = error.read().decode("utf-8", errors="replace")[:1000]
        diagnostic = diagnostic.replace(api_key, "[redacted]")
        print(f"Orbit AI HTTP {error.code}: {diagnostic}")
        try:
            provider_message = json.loads(diagnostic).get("error", {}).get("message", "")
        except json.JSONDecodeError:
            provider_message = ""
        provider_message = " ".join(provider_message.split())[:350]
        messages = {
            400: "Orbit AI rejected the request. Check the configured Gemini model name.",
            401: "Orbit AI could not authenticate the Gemini API key. Create a new key and update Render.",
            403: "Gemini denied this key. Check its API restrictions, billing/quota, and Generative Language API access.",
            404: "The configured Gemini model is unavailable for this key. Set ORBIT_AI_MODEL to an available Gemini model.",
            429: "Gemini quota is currently exhausted. Check your AI Studio quota or try again later.",
        }
        message = messages.get(error.code, "Orbit AI is temporarily unavailable. Please try again shortly.")
        if provider_message:
            message = f"{message} Gemini says: {provider_message}"
        raise HTTPException(status_code=502, detail=message)
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"Orbit AI network request failed: {error}")
        raise HTTPException(status_code=502, detail="Orbit could not reach the AI service. Please try again shortly.")

    candidates = body.get("candidates") or []
    parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
    answer = "".join(part.get("text", "") for part in parts).strip()
    if not answer:
        print(f"Orbit AI returned no usable answer: {body.get('promptFeedback', {})}")
        raise HTTPException(status_code=502, detail="Orbit did not return an answer. Please rephrase and try again.")
    return answer


@app.get("/users/me/second-mind")
def second_mind(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return second_mind_response(build_second_mind_context(current_user, db))


@app.post("/users/me/coach/messages")
def coach_message(
    data: CoachMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    message = data.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Ask Orbit a question first")
    if len(message) > 500:
        raise HTTPException(status_code=400, detail="Keep your question under 500 characters")
    context = build_second_mind_context(current_user, db)
    response = second_mind_response(context, message)
    response["answer"] = ask_orbit_ai(build_orbit_prompt(current_user, db, message))
    response["ai_mode"] = "live"
    return response

@app.get("/users/me/recommendations")
def recommendations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tasks = db.query(Task).filter(
        Task.user_id == current_user.id
    ).order_by(
        Task.created_at.desc()
    ).all()
    latest_daily_data = (
        db.query(DynamicUserData)
        .filter(DynamicUserData.user_id == current_user.id)
        .order_by(DynamicUserData.recorded_at.desc())
        .first()
    )
    completed = 0
    skipped = 0
    rescheduled = 0
    total_logged = 0

    if latest_daily_data and latest_daily_data.energy_level <= 3:
        recommendation = (
            "Your latest energy check-in is low. Schedule a short priority "
            "task and postpone demanding work until your energy improves."
        )
    elif not tasks:
        recommendation = (
            "No activity available yet. Schedule and complete "
            "tasks so the system can learn your routine."
        )

    else:
        completed = sum(
            1 for task in tasks
            if task.status == "completed"
        )

        skipped = sum(
            1 for task in tasks
            if task.status == "skipped"
        )

        rescheduled = sum(
            1 for task in tasks
            if task.rescheduled_time is not None
        )

        total_logged = completed + skipped

        if total_logged:
            rate = completed / total_logged * 100
        else:
            rate = 0

        completed_by_hour = {}
        for task in tasks:
            if task.status == "completed":
                hour = task.scheduled_time.hour
                completed_by_hour[hour] = completed_by_hour.get(hour, 0) + 1

        best_hour = max(completed_by_hour, key=completed_by_hour.get, default=None)

        if skipped > completed:
            recommendation = (
                "Your recent history shows more skipped tasks. "
                "Try reducing task duration and scheduling "
                "fewer high-priority tasks at once."
            )

        elif rescheduled > completed:
            recommendation = (
                "You frequently reschedule tasks. Consider "
                "leaving buffer time between activities and "
                "placing demanding tasks during your preferred "
                "focus period."
            )

        elif best_hour is not None and completed_by_hour[best_hour] >= 2:
            recommendation = (
                f"You complete tasks most reliably around {best_hour:02d}:00. "
                "Use that window for focused work and schedule lighter tasks "
                "outside it."
            )

        elif rate >= 80:
            recommendation = (
                f"Your current completion rate is {rate:.0f}%. "
                "Your routine is performing well. Maintain "
                "consistent focus blocks."
            )

        else:
            recommendation = (
                f"Your current completion rate is {rate:.0f}%. "
                "Try shorter, more realistic task blocks and "
                "review your schedule at the end of the day."
            )

    # Feed the local ML models with the user's latest check-in and behaviour.
    # The model complements (rather than replaces) transparent rule-based
    # advice, so recommendations remain useful even with little history.
    completion_rate = completed / total_logged if total_logged else 0
    mood_value = (latest_daily_data.mood if latest_daily_data else "Neutral") or "Neutral"
    mood_mapping = {"happy": 0, "motivated": 1, "neutral": 2, "sad": 3, "stressed": 4}
    energy_value = latest_daily_data.energy_level if latest_daily_data else 5
    stress_value = latest_daily_data.stress_level if latest_daily_data else 5
    sleep_value = latest_daily_data.sleep_hours if latest_daily_data else 7
    work_value = latest_daily_data.work_hours if latest_daily_data else 0
    exercise_value = latest_daily_data.exercise_minutes if latest_daily_data else 0
    ml_input = {
        "sleep_hours": sleep_value,
        "work_hours": work_value,
        "screen_time_hours": current_user.daily_screen_time or 0,
        "exercise_minutes": exercise_value,
        "mood": mood_mapping.get(str(mood_value).lower(), 2),
        "energy_level": 0 if energy_value <= 3 else 1 if energy_value <= 7 else 2,
        "stress_level": stress_value,
        "focus_level": max(1, min(10, round((energy_value * 0.7) + ((10 - stress_value) * 0.3)))),
        "task_difficulty": {"easy": 0, "medium": 1, "hard": 2}.get(
            (current_user.preferred_task_difficulty or "medium").lower(),
            1,
        ),
        "deadline_days_left": 1,
    }
    ml_insights = predict_task_insights(ml_input)
    priority_labels = {"0": "low", "1": "medium", "2": "high"}
    completion_labels = {"0": "needs a smaller block", "1": "is likely achievable"}
    if "error" in ml_insights:
        adaptive_plan = "Keep your next plan small and review it after you complete it."
    else:
        priority = priority_labels.get(ml_insights["predicted_priority"], "medium")
        likelihood = completion_labels.get(ml_insights["expected_completion"], "needs a smaller block")
        burnout_risk = ml_insights["burnout_risk"]
        if burnout_risk >= 1 or stress_value >= 7 or sleep_value < 6:
            adaptive_plan = "Plan one 25-minute priority block, then take a recovery break before adding another commitment."
        elif completion_rate < 0.5 and total_logged >= 3:
            adaptive_plan = f"Your next {priority}-priority activity {likelihood}; make it a 25-minute block at your most reliable time."
        else:
            adaptive_plan = f"Your next {priority}-priority activity {likelihood}; reserve a focused 45-minute block and protect it from interruptions."

    return {
        "recommendation": recommendation,
        "adaptive_plan": adaptive_plan,
        "model_insights": ml_insights if "error" not in ml_insights else None,
    }


# ============================================================
# CHANGE PASSWORD
# ============================================================

@app.put("/users/me/password")
def change_password(
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if len(data.new_password) < 8:
        raise HTTPException(
            status_code=400,
            detail="New password must contain at least 8 characters",
        )

    current_password_is_valid = (
        verify_password(data.current_password, current_user.password_hash or "")
        or verify_legacy_password(data.current_password, current_user.hashed_password)
    )
    if not current_password_is_valid:
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if hmac.compare_digest(data.current_password, data.new_password):
        raise HTTPException(
            status_code=400,
            detail="New password must be different from the current password",
        )

    current_user.password_hash = hash_password(data.new_password)
    current_user.hashed_password = None
    db.commit()

    return {"message": "Password changed successfully"}


# ============================================================
# HELPER
# ============================================================

def task_to_dict(task: Task):
    return {
        "id": task.id,
        "notification_id": task.id,
        "task_id": task.id,
        "title": task.title,
        "message": task.message,
        "scheduled_time": task.scheduled_time,
        "expected_end_time": task.expected_end_time,
        "start_time": task.scheduled_time,
        "end_time": task.deadline,
        "deadline": task.deadline,
        "duration_minutes": task.duration_minutes,
        "status": task.status,
        "priority": task.priority,
        "user_reason": task.user_reason,
        "rescheduled_time": task.rescheduled_time,
        "start_notified": task.start_notified,
        "end_notified": task.end_notified,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "AI Daily Life OS Backend",
    }
