from datetime import datetime, timedelta
from typing import Optional
import os

from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    Header,
    Query,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import or_
import hashlib
import hmac
import secrets
import base64
import json

from database import engine, Base, get_db, migrate_legacy_schema
from models import User, Task, DynamicUserData


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
    "https://ai-daily-planer.vercel.app",
    "https://ai-daily-planer-git-main-friends24.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # ya testing ke liye ["*"] bhi rakh sakte hain
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
    """Allow pre-migration accounts to log in once and upgrade securely."""
    return bool(stored_password) and hmac.compare_digest(password, stored_password)


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


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    date_of_birth: Optional[datetime] = None
    use_case: Optional[str] = None
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

    if not user.password_hash:
        user.password_hash = hash_password(final_password)
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
            "onboarding_complete": current_user.onboarding_complete,
        },
    }


# ============================================================
# CREATE TASK
# ============================================================

@app.post("/tasks/")
def create_task(
    title: str,
    scheduled_time: datetime,
    expected_end_time: Optional[datetime] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = Task(
        user_id=current_user.id,
        title=title,
        message=title,
        scheduled_time=scheduled_time,
        expected_end_time=expected_end_time,
        status="pending",
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
        "status": task.status,
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
        .order_by(Task.scheduled_time.desc())
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
            "status": task.status,
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

    return {
        "recommendation": recommendation
    }


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
        "status": task.status,
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
