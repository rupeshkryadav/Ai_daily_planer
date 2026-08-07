import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# PostgreSQL connection URL format:
# postgresql://username:password@localhost:5432/database_name
# Apne PostgreSQL ka password yahan set karo:
DATABASE_URL = "postgresql://neondb_owner:npg_q2K7iCcuGOkN@ep-cold-meadow-ayw0g2j9.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()