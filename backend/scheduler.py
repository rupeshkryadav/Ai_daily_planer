from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime
import os

scheduler = BackgroundScheduler()
scheduler.start()

active_notifications = []

def trigger_start_notification(task_id, task_title):
    msg = f"⏰ Start Alert: Task '{task_title}' ka time ho gaya hai!"
    print(f"[BACKGROUND TRIGGER] {msg}")
    active_notifications.append({
        "task_id": task_id,
        "type": "START",
        "message": msg,
        "timestamp": datetime.now().isoformat()
    })

def trigger_end_notification(task_id, task_title):
    msg = f"❓ Completion Check: Kya aapne '{task_title}' poora kar liya?"
    print(f"[BACKGROUND TRIGGER] {msg}")
    active_notifications.append({
        "task_id": task_id,
        "type": "END_CHECK",
        "message": msg,
        "timestamp": datetime.now().isoformat()
    })

def schedule_task_triggers(task_id, task_title, start_time, end_time):
    # Start time trigger
    scheduler.add_job(
        trigger_start_notification,
        'date',
        run_date=start_time,
        args=[task_id, task_title],
        id=f"start_{task_id}",
        replace_existing=True
    )

    # End time trigger
    scheduler.add_job(
        trigger_end_notification,
        'date',
        run_date=end_time,
        args=[task_id, task_title],
        id=f"end_{task_id}",
        replace_existing=True
    )