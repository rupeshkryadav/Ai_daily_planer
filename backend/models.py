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
    preferred_task_difficulty = Column(String(20), nullable=True)
    onboarding_complete = Column(Boolean, default=False, nullable=False)

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
