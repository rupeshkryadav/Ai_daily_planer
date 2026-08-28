import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy import inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing in backend/.env")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def migrate_legacy_schema():
    """Add columns introduced by the current app without deleting old data."""
    if engine.dialect.name != "postgresql":
        return

    migrations = {
        "users": {
            "password_hash": "VARCHAR(255)",
            "name": "VARCHAR(100)",
            "age": "INTEGER",
            "gender": "VARCHAR(50)",
            "date_of_birth": "TIMESTAMP",
            "use_case": "VARCHAR(50)",
            "preferred_focus_time": "VARCHAR(30)",
            "planning_style": "VARCHAR(30)",
            "daily_screen_time": "FLOAT",
            "daily_free_hours": "FLOAT",
            "preferred_task_difficulty": "VARCHAR(20)",
            "onboarding_complete": "BOOLEAN DEFAULT FALSE",
            "last_routine_completed_date": "VARCHAR(10)",
        },
        "tasks": {
            "message": "TEXT",
            "priority": "VARCHAR(10) DEFAULT 'medium' NOT NULL",
            "task_difficulty": "VARCHAR(20)",
            "predicted_productivity_score": "FLOAT",
            "predicted_burnout_level": "FLOAT",
            "predicted_task_priority": "VARCHAR(20)",
            "predicted_task_completion": "VARCHAR(20)",
            "task_energy_level": "FLOAT",
            "task_stress_level": "FLOAT",
            "deadline": "TIMESTAMP",
            "duration_minutes": "INTEGER",
            "rescheduled_time": "TIMESTAMP",
            "completed_at": "TIMESTAMP",
            "delay_duration_minutes": "FLOAT",
            "start_notified": "BOOLEAN DEFAULT FALSE",
            "end_notified": "BOOLEAN DEFAULT FALSE",
            "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "updated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        },
        "coach_messages": {"session_id": "INTEGER"},
    }

    inspector = inspect(engine)
    with engine.begin() as connection:
        for table, columns in migrations.items():
            if table not in inspector.get_table_names():
                continue
            existing = {column["name"] for column in inspector.get_columns(table)}
            for column, definition in columns.items():
                if column not in existing:
                    connection.execute(
                        text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                    )
        # create_all creates this for new installations; legacy deployments
        # need this explicitly because it is a new table.
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS coach_chat_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(120) NOT NULL DEFAULT 'New chat',
                preview VARCHAR(255),
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
