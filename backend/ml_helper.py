import os
import numpy as np
import joblib

# ML Models path set karte hain
MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "ML_models")

def load_pickle(file_name):
    path = os.path.join(MODEL_DIR, file_name)
    # These artifacts were saved with joblib, which supports the compressed
    # model format used by scikit-learn and LightGBM.
    return joblib.load(path)

# Models and Transformers Load kar rahe hain
try:
    productivity_model = load_pickle("productivity_model.pkl")
    burnout_model = load_pickle("burnout_model.pkl")
    task_priority_model = load_pickle("task_priority_model.pkl")
    task_completion_model = load_pickle("task_completion_model.pkl")
    scaler = load_pickle("standard_scaler.pkl")
    label_mappings = load_pickle("label_mappings.pkl")
    feature_columns = load_pickle("feature_columns.pkl")
    print("All ML Models and Scalers loaded successfully!")
except Exception as e:
    print(f"Error loading ML models: {e}")

def predict_task_insights(input_data: dict):
    """
    ML models ke dwara task ki priority, completion likelihood,
    productivity score aur burnout risk predict karne ke liye function.
    """
    try:
        # Preserve the model's training-column order while accepting missing
        # optional signals (for example mood or screen time) safely.
        optional_defaults = {"mood": 2, "screen_time_hours": 0}
        features = []
        for column in feature_columns:
            value = input_data.get(column, optional_defaults.get(column, 0))
            if value is None or (isinstance(value, float) and not np.isfinite(value)):
                value = optional_defaults.get(column, 0)
            features.append(float(value))
        scaled_features = scaler.transform([features])

        priority = task_priority_model.predict(scaled_features)[0]
        completion = task_completion_model.predict(scaled_features)[0]
        productivity = productivity_model.predict(scaled_features)[0]
        burnout = burnout_model.predict(scaled_features)[0]

        return {
            "predicted_priority": str(priority),
            "expected_completion": str(completion),
            "productivity_score": float(productivity),
            "burnout_risk": float(burnout),
        }
    except Exception as e:
        return {"error": str(e)}
