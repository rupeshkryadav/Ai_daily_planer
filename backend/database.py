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
            "onboarding_complete": "BOOLEAN DEFAULT FALSE",
        },
        "tasks": {
            "message": "TEXT",
            "rescheduled_time": "TIMESTAMP",
            "start_notified": "BOOLEAN DEFAULT FALSE",
            "end_notified": "BOOLEAN DEFAULT FALSE",
            "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "updated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        },
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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
