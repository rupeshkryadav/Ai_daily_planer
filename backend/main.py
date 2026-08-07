from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime
import models
from database import engine, get_db
import ml_helper
import scheduler
import ai_coach

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="AI Daily Life OS Backend")

# CORS Enable
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return {"status": "success", "message": "Backend & AI Coach Ready!"}

# --- AUTH ROUTES ---
@app.post("/signup")
def signup(username: str, email: str, password: str, db: Session = Depends(get_db)):
    existing_user = db.query(models.User).filter(models.User.email == email).first()
    if existing_user:
        return {"access_token": f"token_{existing_user.id}", "user": existing_user}
    
    new_user = models.User(username=username, email=email, hashed_password=password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"access_token": f"token_{new_user.id}", "user": new_user}

@app.post("/login")
def login(username: str, password: str, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == username).first()
    if not user or user.hashed_password != password:
        raise HTTPException(status_code=400, detail="Invalid email or password")
    return {"access_token": f"token_{user.id}", "user": user}

# --- NOTIFICATIONS & HISTORY ---
@app.get("/notifications/")
def get_notifications():
    notifications = list(scheduler.active_notifications)
    scheduler.active_notifications.clear()
    return notifications

@app.get("/users/{user_id}/history")
def get_user_history(user_id: int = 1, db: Session = Depends(get_db)):
    tasks = db.query(models.Task).filter(models.Task.user_id == user_id).all()
    return tasks

@app.get("/users/{user_id}/recommendations")
def get_ai_recommendations(user_id: int = 1, db: Session = Depends(get_db)):
    tasks = db.query(models.Task).filter(models.Task.user_id == user_id).all()
    
    if not tasks:
        return {"recommendations": ["Abhi enough data nahi hai. 2-3 tasks complete karke feedback do!"]}

    missed_tasks = [t for t in tasks if t.status in ["missed", "rescheduled"]]
    total_tasks = len(tasks)
    miss_rate = (len(missed_tasks) / total_tasks) * 100 if total_tasks > 0 else 0

    recommendations = []
    if miss_rate > 30:
        recommendations.append("⚠️ Overcommitment Warning: Aapka task miss rate 30% se zyada hai. Tasks ke beech me 15 min ka gap rakhein.")

    late_night_misses = [t for t in missed_tasks if t.scheduled_time and t.scheduled_time.hour >= 20]
    if len(late_night_misses) >= 1:
        recommendations.append("🌙 Fatigue Detection: Raat 8 baje ke baad burnout ke chances high hain. Complex coding ke bajaye light exercise schedule karein.")

    if not recommendations:
        recommendations.append("🌟 Great Consistency! Aapka routine perfect chal raha hai. Keep it up!")

    return {"total_tasks": total_tasks, "missed_count": len(missed_tasks), "recommendations": recommendations}

# --- AI COACH ROUTE ---
@app.get("/users/{user_id}/ai-coach")
def get_ai_coach_insights(user_id: int = 1, db: Session = Depends(get_db)):
    tasks = db.query(models.Task).filter(models.Task.user_id == user_id).all()
    coach_talk = ai_coach.get_personalized_coach(tasks)
    return {"coach_message": coach_talk}

# --- TASK MANAGEMENT ---
@app.post("/tasks/")
def create_task(
    title: str, 
    scheduled_time: str, 
    expected_end_time: str, 
    user_id: int = 1,
    db: Session = Depends(get_db)
):
    s_time = datetime.fromisoformat(scheduled_time)
    e_time = datetime.fromisoformat(expected_end_time)

    new_task = models.Task(
        user_id=user_id,
        title=title,
        scheduled_time=s_time,
        expected_end_time=e_time,
        status="pending"
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)

    scheduler.schedule_task_triggers(new_task.id, new_task.title, s_time, e_time)

    dummy_input = {
        "duration": (e_time - s_time).seconds / 3600,
        "hour_of_day": s_time.hour
    }
    ml_insights = ml_helper.predict_task_insights(dummy_input)

    return {"task": new_task, "ai_insights": ml_insights}

@app.put("/tasks/{task_id}/respond")
def respond_task(
    task_id: int, 
    status: str, 
    user_reason: str = None, 
    next_action: str = None, 
    db: Session = Depends(get_db)
):
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = status
    task.user_reason = user_reason
    task.next_action = next_action
    
    db.commit()
    db.refresh(task)
    return {"message": "Task status updated successfully", "task": task}