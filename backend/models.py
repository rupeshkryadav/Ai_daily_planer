from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    tasks = relationship("Task", back_populates="owner")

class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String, index=True)
    scheduled_time = Column(DateTime)
    expected_end_time = Column(DateTime)
    status = Column(String, default="pending")  # completed, missed, pending, rescheduled
    user_reason = Column(Text, nullable=True)   # Agar nahi hua to kya reason tha
    next_action = Column(Text, nullable=True)   # Kab karega ya kya alternative karega

    owner = relationship("User", back_populates="tasks")