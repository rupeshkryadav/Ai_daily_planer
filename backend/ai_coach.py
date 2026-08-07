import google.generativeai as genai
import os

def get_personalized_coach(history_data):
    try:
        if not history_data:
            return "Abhi aapka koi task history nahi mila hai. Tasks complete kijiye, phir main aapki habits analyze karke tips dunga!"

        history_str = "\n".join([f"- Task: {t.title} | Status: {t.status} | Feedback/Reason: {t.user_reason or 'None'}" for t in history_data])
        
        prompt = f"""
        You are an empathetic, smart AI Daily Life Coach for a user named Rupesh.
        Here is the user's recent task execution history:
        {history_str}
        
        Analyze their activity patterns (missed tasks, delay reasons, consistency).
        Provide a short, motivating, and highly personalized coaching insight in Hinglish (Hindi + English).
        Keep it under 3 concise sentences. Talk naturally like a supportive mentor/friend.
        """

        api_key = os.getenv("GEMINI_API_KEY", "")
        if api_key:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel('gemini-1.5-flash')
            response = model.generate_content(prompt)
            return response.text
            
        raise Exception("API Key not set in environment")

    except Exception as e:
        print("Gemini API Error Detail:", e)
        missed = [t for t in history_data if t.status in ['missed', 'rescheduled']]
        if missed:
            return f"Rupesh, maine dekha aapka '{missed[0].title}' task delay hua hai. Thoda micro-break le kar agle slot par try karo, consistency maintain rahegi!"
        return "Aaj ka routine observe kar raha hu. Sabhi pending tasks time par wrap kar lein, aap mast progress kar rahe ho!"