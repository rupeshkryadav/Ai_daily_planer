from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Text,
    ForeignKey,
    Boolean,
    Float,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    email = Column(String(255), unique=True, nullable=False, index=True)
    # Keep the original fields while existing PostgreSQL installations are
    # migrated. New registrations use password_hash.
    username = Column(String(255), unique=True, nullable=True, index=True)
    hashed_password = Column(String(255), nullable=True)
    password_hash = Column(String(255), nullable=True)

    name = Column(String(100), nullable=True)
    age = Column(Integer, nullable=True)
    gender = Column(String(50), nullable=True)
    date_of_birth = Column(DateTime, nullable=True)
    use_case = Column(String(50), nullable=True)
    preferred_focus_time = Column(String(30), nullable=True)
    planning_style = Column(String(30), nullable=True)
    daily_screen_time = Column(Float, nullable=True)
    daily_free_hours = Column(Float, nullable=True)
    preferred_task_difficulty = Column(String(20), nullable=True)
    onboarding_complete = Column(Boolean, default=False, nullable=False)
    # A server-side value makes the once-per-day routine check-in consistent
    # across browsers and devices (rather than relying only on localStorage).
    last_routine_completed_date = Column(String(10), nullable=True)

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False
    )

    tasks = relationship(
        "Task",
        back_populates="user",
        cascade="all, delete-orphan"
    )
    time_entries = relationship(
        "TimeEntry",
        back_populates="user",
        cascade="all, delete-orphan"
    )


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)

    scheduled_time = Column(DateTime, nullable=False)
    expected_end_time = Column(DateTime, nullable=True)
    # The available window can be much broader than the actual task effort.
    deadline = Column(DateTime, nullable=True)
    duration_minutes = Column(Integer, nullable=True)

    status = Column(
        String(30),
        default="pending",
        nullable=False
    )
    priority = Column(
        String(10),
        default="medium",
        nullable=False
    )
    task_difficulty = Column(String(20), nullable=True)
    predicted_productivity_score = Column(Float, nullable=True)
    predicted_burnout_level = Column(Float, nullable=True)
    predicted_task_priority = Column(String(20), nullable=True)
    predicted_task_completion = Column(String(20), nullable=True)

    user_reason = Column(Text, nullable=True)
    next_action = Column(Text, nullable=True)

    rescheduled_time = Column(DateTime, nullable=True)

    start_notified = Column(Boolean, default=False)
    end_notified = Column(Boolean, default=False)

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False
    )

    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    user = relationship(
        "User",
        back_populates="tasks"
    )


class DynamicUserData(Base):
    __tablename__ = "dynamic_user_data"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    study_hours = Column(Float, default=0)
    work_hours = Column(Float, default=0)
    exercise_minutes = Column(Float, default=0)
    sleep_hours = Column(Float, default=0)
    water_goal = Column(Float, default=0)

    mood = Column(String(50), nullable=True)
    energy_level = Column(Float, default=0)
    stress_level = Column(Float, default=0)

    recorded_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False
    )


class TimeEntry(Base):
    """A small, real-world routine signal used for future schedule training."""
    __tablename__ = "time_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "activity", "occurred_at", name="uq_time_entry"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    activity = Column(String(50), nullable=False)
    occurred_at = Column(DateTime, nullable=False, index=True)
    recorded_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="time_entries")


class DailyReview(Base):
    """End-of-day reality check used to improve future Orbit guidance."""
    __tablename__ = "daily_reviews"
    __table_args__ = (UniqueConstraint("user_id", "review_date", name="uq_daily_review"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    review_date = Column(DateTime, nullable=False, index=True)
    routine_status = Column(String(30), nullable=False)
    notes = Column(Text, nullable=True)
    completed_tasks = Column(Integer, default=0, nullable=False)
    skipped_tasks = Column(Integer, default=0, nullable=False)
    rescheduled_tasks = Column(Integer, default=0, nullable=False)
    recorded_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class CoachMessage(Base):
    """A bounded, private conversation memory for Orbit."""
    __tablename__ = "coach_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(Integer, ForeignKey("coach_chat_sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class CoachChatSession(Base):
    """A named Orbit conversation. Messages remain private to its owner."""
    __tablename__ = "coach_chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(120), nullable=False, default="New chat")
    preview = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, index=True)
