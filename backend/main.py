from datetime import datetime, timedelta, date
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import os
import re
import urllib.error
import urllib.request
import smtplib
from email.message import EmailMessage
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
from models import User, Task, DynamicUserData, TimeEntry, DailyReview, CoachMessage
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
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: Optional[str] = None
    username: Optional[str] = None
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    token: str = Field(min_length=20)
    new_password: str = Field(min_length=8)


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    date_of_birth: Optional[datetime] = None
    use_case: Optional[str] = None
    preferred_focus_time: Optional[str] = None
    planning_style: Optional[str] = None
    daily_screen_time: Optional[float] = None
    daily_free_hours: Optional[float] = Field(default=None, ge=0, le=24)
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


class OnboardingRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    date_of_birth: Optional[datetime] = None
    use_case: str = Field(default="student", max_length=50)
    study_hours: float = Field(default=0, ge=0, le=24)
    work_hours: float = Field(default=0, ge=0, le=24)
    sleep_hours: float = Field(default=0, ge=0, le=24)
    energy_level: float = Field(default=5, ge=1, le=10)
    routine_date: date
    routine_times: dict[str, str] = Field(default_factory=dict)


class TaskCreateRequest(BaseModel):
    title: str
    start_time: datetime
    end_time: datetime
    duration_minutes: int = Field(gt=0, le=60 * 24 * 30)
    priority: str = "medium"
    task_difficulty: Optional[str] = None
    use_suggested_slot: bool = False


class TaskUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    duration_minutes: Optional[int] = Field(default=None, gt=0, le=60 * 24 * 30)
    priority: Optional[str] = None
    task_difficulty: Optional[str] = None


class TimeEntryInput(BaseModel):
    activity: str
    occurred_at: datetime


class TimeEntriesRequest(BaseModel):
    entries: list[TimeEntryInput]


class CoachMessageRequest(BaseModel):
    message: str
    client_time: Optional[datetime] = None
    time_zone: str = Field(default="", max_length=64)


class DailyReviewRequest(BaseModel):
    routine_status: str
    notes: str = Field(default="", max_length=500)
    client_time: Optional[datetime] = None
    time_zone: str = Field(default="", max_length=64)


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
        name=data.name.strip() if data else None,
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "message": "Account created successfully",
        "user_id": user.id,
        "email": user.email,
        # New accounts go straight into the required onboarding wizard.
        "access_token": create_token(user.id),
        "token_type": "bearer",
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
        "daily_free_hours": current_user.daily_free_hours,
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
    if data.daily_free_hours is not None:
        current_user.daily_free_hours = data.daily_free_hours

    if data.preferred_task_difficulty is not None:
        current_user.preferred_task_difficulty = data.preferred_task_difficulty

    if data.onboarding_complete is True:
        raise HTTPException(
            status_code=400,
            detail="Complete the required onboarding flow to activate your workspace",
        )


def create_password_reset_token(user: User) -> str:
    """Create a short-lived reset token invalidated when the password changes."""
    payload = {
        "user_id": user.id,
        "exp": int((datetime.utcnow() + timedelta(minutes=30)).timestamp()),
        "password_version": hashlib.sha256((user.password_hash or "").encode()).hexdigest()[:16],
    }


@app.post("/password-reset/request")
def request_password_reset(data: PasswordResetRequest, db: Session = Depends(get_db)):
    """Send a reset link without revealing whether the email has an account."""
    user = db.query(User).filter(User.email == data.email.strip().lower()).first()
    response = {"message": "If an Orbitday account exists for that email, a reset link has been sent."}
    if not user:
        return response
    reset_token = create_password_reset_token(user)
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    reset_url = f"{frontend_url}/reset-password?token={reset_token}"
    try:
        delivered = send_password_reset_email(user.email, reset_url)
    except (OSError, smtplib.SMTPException) as error:
        print(f"Password-reset email delivery failed: {error}")
        delivered = False
    # No SMTP provider is required for local development; production never
    # exposes the token and instead relies on the configured email service.
    if not delivered and os.getenv("APP_ENV", "development").lower() != "production":
        response["reset_token"] = reset_token
    return response


@app.post("/password-reset/confirm")
def confirm_password_reset(data: PasswordResetConfirmRequest, db: Session = Depends(get_db)):
    try:
        encoded = data.token.split(".", 1)[0]
        payload = json.loads(base64.urlsafe_b64decode(encoded.encode()).decode())
        user_id = int(payload["user_id"])
    except Exception:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new one.")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new one.")
    decode_password_reset_token(data.token, user)
    user.password_hash = hash_password(data.new_password)
    user.hashed_password = None
    db.commit()
    return {"message": "Password reset. You can now sign in with your new password."}
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    signature = hmac.new(TOKEN_SECRET.encode(), f"reset.{encoded}".encode(), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def decode_password_reset_token(token: str, user: User) -> None:
    try:
        encoded, signature = token.split(".", 1)
        expected = hmac.new(TOKEN_SECRET.encode(), f"reset.{encoded}".encode(), hashlib.sha256).hexdigest()
        payload = json.loads(base64.urlsafe_b64decode(encoded.encode()).decode())
        valid_version = hashlib.sha256((user.password_hash or "").encode()).hexdigest()[:16]
        if (not hmac.compare_digest(signature, expected) or payload.get("user_id") != user.id
                or payload.get("password_version") != valid_version
                or payload.get("exp", 0) < int(datetime.utcnow().timestamp())):
            raise ValueError("invalid reset token")
    except Exception:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new one.")


def send_password_reset_email(email: str, reset_url: str) -> bool:
    """Send through SMTP when configured; development can use the returned link."""
    host = os.getenv("SMTP_HOST", "").strip()
    sender = os.getenv("SMTP_FROM", "").strip()
    if not host or not sender:
        return False
    message = EmailMessage()
    message["Subject"] = "Reset your Orbitday password"
    message["From"] = sender
    message["To"] = email
    message.set_content(f"Use this link within 30 minutes to reset your Orbitday password:\n\n{reset_url}")
    with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=15) as client:
        if os.getenv("SMTP_STARTTLS", "true").lower() != "false":
            client.starttls()
        username, password = os.getenv("SMTP_USERNAME", ""), os.getenv("SMTP_PASSWORD", "")
        if username:
            client.login(username, password)
        client.send_message(message)
    return True

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
            "daily_free_hours": current_user.daily_free_hours,
            "preferred_task_difficulty": current_user.preferred_task_difficulty,
            "onboarding_complete": current_user.onboarding_complete,
        },
    }


@app.post("/users/me/onboarding")
def complete_onboarding(
    data: OnboardingRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Persist the initial profile, check-in, and selected routine as one flow."""
    allowed_activities = {
        "wake_up", "work_start", "lunch", "study", "exercise", "dinner",
        "wind_down", "sleep", "breakfast", "commute", "chores",
        "entertainment", "social_time",
    }
    current_user.name = data.name.strip()
    current_user.date_of_birth = data.date_of_birth
    current_user.use_case = data.use_case

    for activity, time_value in data.routine_times.items():
        if activity not in allowed_activities:
            raise HTTPException(status_code=400, detail=f"Unknown routine activity: {activity}")
        try:
            occurred_at = datetime.strptime(
                f"{data.routine_date.isoformat()} {time_value}", "%Y-%m-%d %H:%M"
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Routine times must use HH:MM format")
        existing = db.query(TimeEntry).filter(
            TimeEntry.user_id == current_user.id,
            TimeEntry.activity == activity,
            TimeEntry.occurred_at == occurred_at,
        ).first()
        if not existing:
            db.add(TimeEntry(user_id=current_user.id, activity=activity, occurred_at=occurred_at))

    db.add(DynamicUserData(
        user_id=current_user.id,
        study_hours=data.study_hours,
        work_hours=data.work_hours,
        sleep_hours=data.sleep_hours,
        energy_level=data.energy_level,
    ))
    current_user.onboarding_complete = True
    db.commit()
    db.refresh(current_user)
    return {"message": "Onboarding complete", "user": get_me(current_user)}


# ============================================================
# CREATE TASK
# ============================================================

ROUTINE_BLOCK_MINUTES = {
    "wake_up": 30, "breakfast": 30, "commute": 60, "work_start": 480,
    "lunch": 45, "study": 90, "exercise": 60, "chores": 45,
    "dinner": 45, "entertainment": 90, "social_time": 60,
    "wind_down": 45, "sleep": 480,
}


def normalized_task_difficulty(value: Optional[str], current_user: User) -> str:
    difficulty = (value or current_user.preferred_task_difficulty or "medium").strip().lower()
    if difficulty not in {"easy", "medium", "hard"}:
        raise HTTPException(status_code=400, detail="Task difficulty must be easy, medium, or hard")
    return difficulty


def derived_exercise_minutes(current_user: User, db: Session, target_day: date) -> float:
    """Estimate exercise from logged routine intervals and actual exercise-task durations."""
    day_start = datetime.combine(target_day, datetime.min.time())
    day_end = day_start + timedelta(days=1)
    entries = db.query(TimeEntry).filter(
        TimeEntry.user_id == current_user.id,
        TimeEntry.occurred_at >= day_start,
        TimeEntry.occurred_at < day_end,
    ).order_by(TimeEntry.occurred_at.asc()).all()
    total = 0.0
    for index, entry in enumerate(entries):
        if entry.activity != "exercise":
            continue
        next_entry = entries[index + 1] if index + 1 < len(entries) else None
        if next_entry:
            duration = (next_entry.occurred_at - entry.occurred_at).total_seconds() / 60
            total += duration if 5 <= duration <= 240 else ROUTINE_BLOCK_MINUTES["exercise"]
        else:
            total += ROUTINE_BLOCK_MINUTES["exercise"]
    exercise_tasks = db.query(Task).filter(
        Task.user_id == current_user.id,
        Task.scheduled_time >= day_start,
        Task.scheduled_time < day_end,
    ).all()
    total += sum(
        task.duration_minutes or 0 for task in exercise_tasks
        if any(word in task.title.lower() for word in ("exercise", "workout", "gym", "run", "jog"))
    )
    return round(total, 1)


def build_task_ml_input(
    current_user: User,
    db: Session,
    deadline: datetime,
    difficulty: Optional[str] = None,
    reference_time: Optional[datetime] = None,
) -> dict:
    """Use saved user signals and real task timing; never inject placeholder deadlines."""
    now = reference_time or datetime.utcnow()
    latest = db.query(DynamicUserData).filter(
        DynamicUserData.user_id == current_user.id,
    ).order_by(DynamicUserData.recorded_at.desc()).first()
    exercise_from_activity = derived_exercise_minutes(current_user, db, now.date())
    logged_exercise = latest.exercise_minutes if latest and latest.exercise_minutes is not None else 0
    energy = latest.energy_level if latest and latest.energy_level is not None else 5
    stress = latest.stress_level if latest and latest.stress_level is not None else 5
    mood_mapping = {"happy": 0, "motivated": 1, "neutral": 2, "sad": 3, "stressed": 4}
    mood = mood_mapping.get((latest.mood or "neutral").lower(), 2) if latest else 2
    deadline_days_left = max(0, int((deadline - now).total_seconds() / 86400 + 0.9999))
    return {
        "sleep_hours": latest.sleep_hours if latest and latest.sleep_hours is not None else 7,
        "work_hours": latest.work_hours if latest and latest.work_hours is not None else 0,
        "screen_time_hours": current_user.daily_screen_time if current_user.daily_screen_time is not None else 0,
        "exercise_minutes": max(float(logged_exercise or 0), exercise_from_activity),
        "mood": mood,
        "energy_level": 0 if energy <= 3 else 1 if energy <= 7 else 2,
        "stress_level": stress,
        "focus_level": max(1, min(10, round((energy * 0.7) + ((10 - stress) * 0.3)))),
        "task_difficulty": {"easy": 0, "medium": 1, "hard": 2}[normalized_task_difficulty(difficulty, current_user)],
        "deadline_days_left": deadline_days_left,
    }


def store_task_prediction(task: Task, current_user: User, db: Session) -> dict:
    insights = predict_task_insights(build_task_ml_input(
        current_user, db, task.deadline or task.expected_end_time or task.scheduled_time, task.task_difficulty,
    ))
    if "error" not in insights:
        task.predicted_productivity_score = insights["productivity_score"]
        task.predicted_burnout_level = insights["burnout_risk"]
        task.predicted_task_priority = insights["predicted_priority"]
        task.predicted_task_completion = insights["expected_completion"]
    return insights


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
    activity_title: str = "",
) -> Optional[datetime]:
    """Return a free gap, keeping workouts out of unsafe midday/late-night hours."""
    candidate = available_from
    if candidate + timedelta(minutes=duration_minutes) > deadline:
        return None
    is_exercise = any(word in activity_title.lower() for word in ("run", "jog", "workout", "exercise", "gym"))

    def activity_fits(start: datetime) -> bool:
        if not is_exercise:
            return True
        # Running/workouts belong in morning or early evening, never 12–15 or 23–05.
        end = start + timedelta(minutes=duration_minutes)
        return (5 <= start.hour < 12 or 17 <= start.hour < 22) and end.date() == start.date()

    for block in occupied_schedule_blocks(user_id, available_from, deadline, db):
        if candidate + timedelta(minutes=duration_minutes) <= block["start"] and activity_fits(candidate):
            return candidate
        if block["end"] > candidate:
            candidate = block["end"]
    if candidate + timedelta(minutes=duration_minutes) <= deadline and activity_fits(candidate):
        return candidate
    # For exercise, search suitable morning/evening quarter-hour candidates.
    if is_exercise:
        cursor = max(available_from, datetime.combine(available_from.date(), datetime.min.time()).replace(hour=5))
        while cursor + timedelta(minutes=duration_minutes) <= deadline:
            if activity_fits(cursor) and not any(
                cursor < block["end"] and cursor + timedelta(minutes=duration_minutes) > block["start"]
                for block in occupied_schedule_blocks(user_id, cursor, cursor + timedelta(minutes=duration_minutes), db)
            ):
                return cursor
            cursor += timedelta(minutes=15)
    return None


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
    suggestion = find_free_task_slot(current_user.id, available_from, deadline, data.duration_minutes, db, data.title)
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
        final_difficulty = normalized_task_difficulty(data.task_difficulty, current_user)
    else:
        final_title = (title or "").strip()
        available_from = scheduled_time.replace(tzinfo=None) if scheduled_time else None
        deadline = expected_end_time.replace(tzinfo=None) if expected_end_time else None
        duration_minutes = int((expected_end_time - scheduled_time).total_seconds() // 60) if scheduled_time and expected_end_time else None
        final_priority = priority
        final_difficulty = normalized_task_difficulty(None, current_user)

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
            current_user.id, available_from, deadline, duration_minutes, db, final_title
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
        task_difficulty=final_difficulty,
    )

    db.add(task)
    store_task_prediction(task, current_user, db)
    db.commit()
    db.refresh(task)
    return task_to_dict(task)


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
            "task_difficulty": task.task_difficulty,
            "predictions": {
                "productivity_score": task.predicted_productivity_score,
                "burnout_level": task.predicted_burnout_level,
                "task_priority": task.predicted_task_priority,
                "task_completion": task.predicted_task_completion,
            },
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


@app.put("/tasks/{task_id}")
def update_task(
    task_id: int,
    data: TaskUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if data.title is not None:
        task.title = data.title.strip()
        task.message = task.title
    if data.priority is not None:
        priority = data.priority.lower().strip()
        if priority not in {"low", "medium", "high"}:
            raise HTTPException(status_code=400, detail="Priority must be low, medium, or high")
        task.priority = priority
    if data.task_difficulty is not None:
        task.task_difficulty = normalized_task_difficulty(data.task_difficulty, current_user)
    start = data.start_time.replace(tzinfo=None) if data.start_time else task.scheduled_time
    deadline = data.end_time.replace(tzinfo=None) if data.end_time else task.deadline
    duration = data.duration_minutes if data.duration_minutes is not None else task.duration_minutes
    if not deadline or deadline <= start or not duration or start + timedelta(minutes=duration) > deadline:
        raise HTTPException(status_code=400, detail="The task duration must fit inside its start and deadline window")
    task.scheduled_time, task.deadline, task.duration_minutes = start, deadline, duration
    task.expected_end_time = start + timedelta(minutes=duration)
    store_task_prediction(task, current_user, db)
    db.commit()
    db.refresh(task)
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
        if activity not in ROUTINE_ACTIVITIES and not re.fullmatch(r"custom_[a-z0-9_]{1,40}", activity):
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


@app.post("/users/me/daily-review")
def save_daily_review(
    data: DailyReviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if data.routine_status not in {"followed", "partly_followed", "not_followed"}:
        raise HTTPException(status_code=400, detail="Choose whether your routine was followed, partly followed, or not followed")
    now = user_local_now(data.client_time, data.time_zone)
    review_day = datetime.combine(now.date(), datetime.min.time())
    today_tasks = db.query(Task).filter(
        Task.user_id == current_user.id,
        Task.scheduled_time >= review_day,
        Task.scheduled_time < review_day + timedelta(days=1),
    ).all()
    review = db.query(DailyReview).filter(
        DailyReview.user_id == current_user.id,
        DailyReview.review_date == review_day,
    ).first()
    if not review:
        review = DailyReview(user_id=current_user.id, review_date=review_day, routine_status=data.routine_status)
        db.add(review)
    review.routine_status = data.routine_status
    review.notes = data.notes.strip() or None
    review.completed_tasks = sum(task.status == "completed" for task in today_tasks)
    review.skipped_tasks = sum(task.status == "skipped" for task in today_tasks)
    review.rescheduled_tasks = sum(task.rescheduled_time is not None for task in today_tasks)
    review.recorded_at = datetime.utcnow()
    db.commit()
    return {"message": "Daily wrap-up saved. Orbit will use it in future recommendations."}


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
        "daily_free_hours": current_user.daily_free_hours or 0,
        "sleep_hours": 7.5,
        "work_hours": 8 if current_user.use_case == "professional" else 4 if current_user.use_case == "student" else 2,
        "exercise_minutes": 30,
        "energy": 6,
        "stress": 4,
        "block_minutes": 60 if current_user.planning_style == "structured" else 45,
    }


def infer_today_state(current_user: User, db: Session, now: datetime) -> dict:
    """Estimate fresh scheduling signals from today's real activity—not profile defaults."""
    day_start = datetime.combine(now.date(), datetime.min.time())
    day_end = day_start + timedelta(days=1)
    today_tasks = db.query(Task).filter(
        Task.user_id == current_user.id,
        Task.scheduled_time >= day_start,
        Task.scheduled_time < day_end,
    ).all()
    today_routine = db.query(TimeEntry).filter(
        TimeEntry.user_id == current_user.id,
        TimeEntry.occurred_at >= day_start,
        TimeEntry.occurred_at < day_end,
    ).all()
    completed = [task for task in today_tasks if task.status == "completed"]
    unfinished = [task for task in today_tasks if task.status not in ("completed", "skipped")]
    overdue = [task for task in unfinished if (task.expected_end_time or task.scheduled_time) < now]
    planned_minutes = sum(task.duration_minutes or 30 for task in today_tasks)
    completed_minutes = sum(task.duration_minutes or 30 for task in completed)

    # Find a real sleep span when both events were logged, including the
    # previous evening's sleep event and today's wake-up.
    recent_routine = db.query(TimeEntry).filter(
        TimeEntry.user_id == current_user.id,
        TimeEntry.occurred_at >= day_start - timedelta(days=1),
        TimeEntry.occurred_at < day_end,
    ).order_by(TimeEntry.occurred_at.asc()).all()
    sleep_hours = None
    sleep_entries = [entry for entry in recent_routine if entry.activity == "sleep"]
    wake_entries = [entry for entry in recent_routine if entry.activity == "wake_up"]
    if sleep_entries and wake_entries:
        last_sleep = sleep_entries[-1]
        following_wakes = [entry for entry in wake_entries if entry.occurred_at > last_sleep.occurred_at]
        if following_wakes:
            sleep_hours = round((following_wakes[0].occurred_at - last_sleep.occurred_at).total_seconds() / 3600, 1)

    energy = 7
    if now.hour >= 16:
        energy -= 1
    if now.hour >= 21:
        energy -= 1
    if sleep_hours is not None and sleep_hours < 6:
        energy -= 2
    if planned_minutes >= 480:
        energy -= 1
    if len(overdue) >= 2:
        energy -= 1
    if completed_minutes >= 90:
        energy -= 1
    energy = max(1, min(10, energy))

    stress = 3 + min(3, len(overdue)) + (1 if planned_minutes >= 480 else 0)
    if completed and not overdue:
        stress -= 1
    stress = max(1, min(10, stress))
    latest_activity = max((entry for entry in today_routine if entry.occurred_at <= now), key=lambda entry: entry.occurred_at, default=None)
    return {
        "energy": energy,
        "stress": stress,
        "sleep": sleep_hours,
        "planned_minutes": planned_minutes,
        "completed_minutes": completed_minutes,
        "overdue_count": len(overdue),
        "latest_activity": latest_activity.activity.replace("_", " ") if latest_activity else None,
        "source": "Inferred from today's routine, task load, progress, and time of day.",
    }


def build_second_mind_context(current_user: User, db: Session, now: Optional[datetime] = None) -> dict:
    """Blend a temporary synthetic prior into real user signals until sufficient history exists."""
    tasks = db.query(Task).filter(Task.user_id == current_user.id).all()
    completed = [task for task in tasks if task.status == "completed"]
    prior = bootstrap_profile(current_user)
    now = now or datetime.now()
    today_state = infer_today_state(current_user, db, now)
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

    energy_value = today_state["energy"]
    stress_value = today_state["stress"]
    sleep_value = today_state["sleep"] if today_state["sleep"] is not None else prior["sleep_hours"]
    next_task = min(
        (task for task in tasks if task.status not in ("completed", "skipped") and task.deadline),
        key=lambda task: task.deadline,
        default=None,
    )
    ml_input = build_task_ml_input(
        current_user, db, next_task.deadline if next_task else now + timedelta(days=7),
        next_task.task_difficulty if next_task else None, now,
    )
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
        "today_state": today_state,
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


def user_local_now(client_time: Optional[datetime], time_zone: str = "") -> datetime:
    """Convert the browser's UTC timestamp to the user's stated IANA timezone."""
    if not client_time:
        return datetime.now()
    if client_time.tzinfo is None:
        return client_time
    try:
        return client_time.astimezone(ZoneInfo(time_zone or "UTC")).replace(tzinfo=None)
    except ZoneInfoNotFoundError:
        return client_time.astimezone().replace(tzinfo=None)


def assemble_orbit_context(
    current_user: User,
    db: Session,
    question: str,
    client_time: Optional[datetime] = None,
    time_zone: str = "",
) -> str:
    """Assemble profile, plans, history, routine, ML signals, and conversation for Gemini."""
    # Render runs in UTC; planned tasks and routine entries are entered in the
    # user's local time. Prefer the timestamp supplied by the signed-in app.
    now = user_local_now(client_time, time_zone)
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
    latest_review = (
        db.query(DailyReview)
        .filter(DailyReview.user_id == current_user.id)
        .order_by(DailyReview.review_date.desc())
        .first()
    )
    conversation = db.query(CoachMessage).filter(
        CoachMessage.user_id == current_user.id
    ).order_by(CoachMessage.created_at.desc()).limit(12).all()
    model_context = build_second_mind_context(current_user, db, now)

    planned = "\n".join(
        f"- {task.title} | {task.priority} priority | planned {format_orbit_datetime(task.scheduled_time)}"
        f" | duration {task.duration_minutes or 'unspecified'} min | difficulty {task.task_difficulty or 'not set'}"
        f" | available until {format_orbit_datetime(task.deadline)} | predicted productivity {task.predicted_productivity_score if task.predicted_productivity_score is not None else 'not scored'}"
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
    today_routine = [entry for entry in routine_entries if entry.occurred_at.date() == now.date()]
    today_routine_text = "\n".join(
        f"- {entry.activity.replace('_', ' ')} at {entry.occurred_at.strftime('%I:%M %p').lstrip('0')}"
        for entry in reversed(today_routine)
    ) or "- No routine commitments are saved for today."
    past_routine = sorted(entry for entry in today_routine if entry.occurred_at <= now)
    future_routine = sorted(entry for entry in today_routine if entry.occurred_at > now)
    routine_state = (
        f"Likely in {past_routine[-1].activity.replace('_', ' ')} since "
        f"{past_routine[-1].occurred_at.strftime('%I:%M %p').lstrip('0')}; "
        f"next saved commitment is {future_routine[0].activity.replace('_', ' ')} at "
        f"{future_routine[0].occurred_at.strftime('%I:%M %p').lstrip('0')}."
        if past_routine and future_routine else "No current routine interval can be inferred from today's saved times."
    )
    inferred_state = infer_today_state(current_user, db, now)
    wellbeing = (
        f"inferred energy {inferred_state['energy']}/10, inferred stress {inferred_state['stress']}/10, "
        f"sleep {inferred_state['sleep'] if inferred_state['sleep'] is not None else 'not logged'} hours, "
        f"planned {inferred_state['planned_minutes']} min, completed {inferred_state['completed_minutes']} min, "
        f"overdue tasks {inferred_state['overdue_count']}. {inferred_state['source']}"
    )
    review_summary = (
        f"Routine {latest_review.routine_status.replace('_', ' ')}; "
        f"completed {latest_review.completed_tasks}, skipped {latest_review.skipped_tasks}, "
        f"rescheduled {latest_review.rescheduled_tasks}. "
        f"Notes: {latest_review.notes or 'none'}"
        if latest_review else "No end-of-day review has been recorded yet."
    )
    conversation_text = "\n".join(
        f"{item.role.title()}: {item.content}" for item in reversed(conversation)
    ) or "- This is the first message in the conversation."
    model_summary = model_context["model"]
    account_stage = "new user, still building a history" if model_context["completed_count"] < 3 else "returning user with saved history"
    routine_status = "routine has entries today" if today_routine else "no routine entries saved today"

    return f"""You are Orbit, a warm, practical personal planning assistant. Reply naturally, as a thoughtful person—not as a generic chatbot.

Current user-local time: {format_orbit_datetime(now)}{f' ({time_zone})' if time_zone else ''}.
User: {current_user.name or 'there'}; {account_stage}; today {routine_status}; focus: {current_user.use_case or 'not set'}; planning style: {current_user.planning_style or 'not set'}; preferred focus: {current_user.preferred_focus_time or 'not set'}; free time: {current_user.daily_free_hours if current_user.daily_free_hours is not None else 'not set'} hours.

The following is private, real data from this user's account. Use it to answer accurately. Do not claim you completed, changed, or scheduled anything. If the needed information is absent, say so plainly and suggest the smallest helpful next step. Do not make up appointments, routines, facts, or times. Keep the answer to at most 140 words and use short paragraphs or bullets only when they improve clarity.

For scheduling questions, first account for the current user-local time, every planned task window and duration, and today's saved routine commitments. Treat a saved routine time as busy: never recommend that exact time, or the 30 minutes around it, unless the user explicitly asks to replace it. Prefer a future free slot. State why the suggested time fits and mention a conflict when you avoided one. Never answer with only a time, an asterisk, or an unexplained one-line schedule.

If a user asks to create or schedule a task but has not supplied duration or deadline/available window, ask only for the missing fields before proposing a schedule. Their stated daily free-time estimate is {current_user.daily_free_hours or 'not set'} hours; use it as a workload limit, while task and routine times remain the source of exact free slots.

Match the time to the activity: running and workouts belong in a safe morning or early-evening window, not the middle of work or near bedtime. If it is already afternoon, do not suggest a past morning time for today. Use the latest sleep, energy and stress signals; when recovery is needed, say so and recommend a lighter option instead of a demanding activity.

TODAY / UPCOMING PLAN:
{planned}

RECENT TASK OUTCOMES:
{history}

SAVED ROUTINE TIMES:
{routine}

TODAY'S SAVED ROUTINE COMMITMENTS (BUSY TIMES):
{today_routine_text}

INFERRED CURRENT ROUTINE STATE:
{routine_state}

LATEST WELLBEING CHECK-IN:
{wellbeing}

LATEST END-OF-DAY REVIEW:
{review_summary}

CURRENT ML PREDICTIONS:
productivity {model_summary.get('productivity_score', 'unavailable')}; burnout {model_summary.get('burnout_risk', 'unavailable')}; suggested priority {model_summary.get('predicted_priority', 'unavailable')}; completion {model_summary.get('expected_completion', 'unavailable')}. These are advisory signals, not facts.

RECENT CONVERSATION:
{conversation_text}

User question: {question}
"""


build_orbit_prompt = assemble_orbit_context


def ask_orbit_ai(prompt: str, safe_fallback: str) -> str:
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

    def response_text(response_body: dict) -> str:
        candidates = response_body.get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
        return "".join(part.get("text", "") for part in parts).strip()

    def is_usable_answer(value: str) -> bool:
        words = re.findall(r"[A-Za-z]{2,}", value)
        time_fragment = re.fullmatch(r"[\d\s:–—\-().,*APMapmto]+", value)
        return (
            # Conversational questions deserve a natural short reply too;
            # reject only fragments, not concise but complete answers.
            len(words) >= 6
            and len(value) >= 30
            and not time_fragment
            and value.rstrip().endswith((".", "!", "?"))
        )

    answer = response_text(body)
    if not is_usable_answer(answer):
        # A model can occasionally emit a partial token stream under load.
        # Retry once with a direct formatting correction before showing anything.
        retry_payload = json.dumps({
            "contents": [{"role": "user", "parts": [{"text": prompt + "\n\nReturn a complete natural-language answer now. Do not return a time fragment, bare range, markdown asterisk, or partial sentence. Explain the suggested future slot and the saved routine/task conflict you avoided."}]}],
            "generationConfig": {"maxOutputTokens": 500},
        }).encode("utf-8")
        try:
            retry_request = urllib.request.Request(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
                data=retry_payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(retry_request, timeout=25) as retry_response:
                retry_answer = response_text(json.loads(retry_response.read().decode("utf-8")))
            if is_usable_answer(retry_answer):
                answer = retry_answer
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            print(f"Orbit AI quality retry failed: {error}")
    if not answer:
        print(f"Orbit AI returned no usable answer: {body.get('promptFeedback', {})}")
        raise HTTPException(status_code=502, detail="Orbit did not return an answer. Please rephrase and try again.")
    if not is_usable_answer(answer):
        raise HTTPException(
            status_code=502,
            detail="Gemini returned an incomplete response. Please try your message again.",
        )
    return answer


def is_explicit_scheduling_request(message: str) -> bool:
    """Only schedule when the user actually asks to schedule or find a time."""
    text = message.lower()
    return bool(re.search(
        r"\b(schedule|reschedule|plan|slot|calendar|what time|when should i|find (?:me )?a time|fit .* (?:today|tomorrow))\b",
        text,
    ))


def build_orbit_safe_fallback(
    current_user: User,
    db: Session,
    question: str,
    client_time: Optional[datetime],
    time_zone: str,
) -> str:
    """Give a correct schedule answer if the provider sends a partial response."""
    now = user_local_now(client_time, time_zone)
    question_text = question.lower()
    is_running = any(word in question_text for word in ("run", "running", "jog"))
    is_workout = is_running or any(word in question_text for word in ("workout", "exercise", "gym"))
    is_reading = any(word in question_text for word in ("read", "novel", "book"))
    is_focus_work = any(word in question_text for word in ("study", "coding", "code", "project", "assignment", "deep work"))
    duration_match = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|minutes?|mins?|min)\b", question_text)
    if duration_match:
        requested_amount = float(duration_match.group(1))
        duration = round(requested_amount * 60) if re.search(r"\b(hours?|hrs?|hr)\b", duration_match.group(0)) else round(requested_amount)
    else:
        duration = 30 if is_reading or is_running else 45 if is_focus_work else 25
    duration = max(15, min(duration, 8 * 60))
    explicitly_today = "today" in question_text
    day_end = datetime.combine(now.date(), datetime.max.time()).replace(hour=23, minute=30, second=0, microsecond=0)
    busy_windows = []
    for entry in db.query(TimeEntry).filter(TimeEntry.user_id == current_user.id).all():
        if entry.occurred_at.date() == now.date():
            busy_windows.append((entry.occurred_at - timedelta(minutes=30), entry.occurred_at + timedelta(minutes=30)))
    today_tasks = [task for task in db.query(Task).filter(
        Task.user_id == current_user.id,
        Task.status.notin_(["completed", "skipped"]),
    ).all() if task.scheduled_time.date() == now.date()]
    for task in today_tasks:
        task_end = task.expected_end_time or (task.scheduled_time + timedelta(minutes=task.duration_minutes or 30))
        busy_windows.append((task.scheduled_time, task_end))

    inferred_state = infer_today_state(current_user, db, now)
    wellbeing_status = (
        f"Based on today’s routine and workload, Orbit estimates energy {inferred_state['energy']}/10 "
        f"and stress {inferred_state['stress']}/10."
    )
    if inferred_state["energy"] <= 3 or inferred_state["stress"] >= 8 or (
        inferred_state["sleep"] is not None and inferred_state["sleep"] < 6
    ):
        return (
            "Today’s routine and workload suggest recovery first, so I would not schedule a demanding session right now. "
            "Take a short walk, hydrate, or choose a light activity, then reassess your energy before planning exercise."
        )

    slot = (now + timedelta(minutes=15)).replace(second=0, microsecond=0)
    slot += timedelta(minutes=(15 - slot.minute % 15) % 15)
    preferred_slots = []
    if is_workout:
        for hour, minute in ((6, 0), (6, 30), (7, 0), (7, 30), (17, 30), (18, 0), (18, 30), (19, 0)):
            candidate = datetime.combine(now.date(), datetime.min.time()).replace(hour=hour, minute=minute)
            if candidate >= slot:
                preferred_slots.append(candidate)
        if not preferred_slots:
            tomorrow = now.date() + timedelta(days=1)
            preferred_slots = [datetime.combine(tomorrow, datetime.min.time()).replace(hour=6, minute=30)]
    elif is_focus_work and now.hour >= 15 and not explicitly_today:
        # Avoid late-afternoon deep work after a full day; prefer tomorrow's
        # first focus window instead of inventing a past morning slot.
        tomorrow = now.date() + timedelta(days=1)
        preferred_slots = [datetime.combine(tomorrow, datetime.min.time()).replace(hour=8, minute=0)]
    elif is_reading and now.hour >= 16:
        # Reading is low-intensity and works well in a calm evening slot.
        for hour, minute in ((18, 0), (19, 0), (20, 0)):
            candidate = datetime.combine(now.date(), datetime.min.time()).replace(hour=hour, minute=minute)
            if candidate >= slot:
                preferred_slots.append(candidate)
    candidates_to_check = preferred_slots or [slot + timedelta(minutes=15 * index) for index in range(40)]
    for slot in candidates_to_check:
        slot_end = slot + timedelta(minutes=duration)
        slot_day_end = datetime.combine(slot.date(), datetime.max.time()).replace(hour=23, minute=30, second=0, microsecond=0)
        if slot_end <= slot_day_end and not any(slot < end and slot_end > start for start, end in busy_windows):
            activity = "go for a run" if is_running else "do your workout" if is_workout else "read your novel" if is_reading else "do focused work" if is_focus_work else "work on this"
            day_label = "tomorrow" if slot.date() > now.date() else "today"
            return (
                f"It is {now.strftime('%I:%M %p').lstrip('0')} now. {wellbeing_status} "
                f"Plan to {activity} {day_label} at {slot.strftime('%I:%M %p').lstrip('0')} for {duration} minutes. "
                "That is a future, activity-appropriate free window that avoids the routine and task times you saved."
            )
    if explicitly_today:
        remaining_busy = sorted((start, end) for start, end in busy_windows if end > now)
        cursor = slot
        largest_free = timedelta(0)
        for start, end in remaining_busy + [(day_end, day_end)]:
            if start > cursor:
                largest_free = max(largest_free, start - cursor)
            cursor = max(cursor, end)
        flexible_task = next((task for task in sorted(today_tasks, key=lambda item: item.scheduled_time)
                              if task.status == "pending" and task.priority == "low" and task.scheduled_time >= now), None)
        tradeoff = (
            f" The most flexible planned item is '{flexible_task.title}' at "
            f"{flexible_task.scheduled_time.strftime('%I:%M %p').lstrip('0')}; moving it is the first trade-off to consider."
            if flexible_task else ""
        )
        return (
            f"It is {now.strftime('%I:%M %p').lstrip('0')} now. {wellbeing_status} "
            f"I cannot find one uninterrupted {duration}-minute window left today after protecting your saved tasks and routine. "
            f"The largest remaining gap is about {max(0, round(largest_free.total_seconds() / 60))} minutes. "
            f"You could split the work into two focused blocks today, or move the full session to tomorrow morning.{tradeoff}"
        )
    return (
        "I can see that the rest of today is too tight around your saved commitments. "
        "Plan a 30-minute session tomorrow, and I’ll help you choose a specific window once tomorrow’s routine is saved."
    )


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
    local_now = user_local_now(data.client_time, data.time_zone)
    context = build_second_mind_context(current_user, db, local_now)
    response = second_mind_response(context, message)
    response["today_state"] = context["today_state"]
    scheduling_request = is_explicit_scheduling_request(message)
    safe_fallback = build_orbit_safe_fallback(current_user, db, message, data.client_time, data.time_zone) if scheduling_request else ""
    db.add(CoachMessage(user_id=current_user.id, role="user", content=message))
    try:
        response["answer"] = ask_orbit_ai(
            assemble_orbit_context(current_user, db, message, data.client_time, data.time_zone),
            safe_fallback,
        )
        response["ai_mode"] = "live"
    except HTTPException as error:
        if error.status_code < 500:
            raise
        if not scheduling_request:
            # Do not turn a greeting into a made-up planning slot when Gemini
            # is unavailable; expose the actionable provider failure instead.
            raise HTTPException(status_code=error.status_code, detail=error.detail)
        response["answer"] = safe_fallback
        response["ai_mode"] = "schedule fallback"
    db.add(CoachMessage(user_id=current_user.id, role="assistant", content=response["answer"]))
    db.commit()
    return response


@app.get("/users/me/coach/messages")
def get_coach_messages(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    messages = db.query(CoachMessage).filter(
        CoachMessage.user_id == current_user.id
    ).order_by(CoachMessage.created_at.desc()).limit(30).all()
    return [{"role": item.role, "text": item.content, "created_at": item.created_at} for item in reversed(messages)]

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
    energy_value = latest_daily_data.energy_level if latest_daily_data and latest_daily_data.energy_level is not None else 5
    stress_value = latest_daily_data.stress_level if latest_daily_data and latest_daily_data.stress_level is not None else 5
    sleep_value = latest_daily_data.sleep_hours if latest_daily_data and latest_daily_data.sleep_hours is not None else 7
    next_task = min(
        (task for task in tasks if task.status not in ("completed", "skipped") and task.deadline),
        key=lambda task: task.deadline,
        default=None,
    )
    ml_input = build_task_ml_input(
        current_user, db, next_task.deadline if next_task else datetime.utcnow() + timedelta(days=7),
        next_task.task_difficulty if next_task else None,
    )
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
        "task_difficulty": task.task_difficulty,
        "predictions": {
            "productivity_score": task.predicted_productivity_score,
            "burnout_level": task.predicted_burnout_level,
            "task_priority": task.predicted_task_priority,
            "task_completion": task.predicted_task_completion,
        },
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
