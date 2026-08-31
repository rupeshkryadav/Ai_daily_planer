# Launch checklist

## Backend (Render)

1. Deploy the `backend` service from this repository using its existing build and start settings.
2. In the Render service environment settings, add these secret values:
   - `DATABASE_URL` — the existing production PostgreSQL connection string.
   - `TOKEN_SECRET` — a long random value.
   - `GEMINI_API_KEY` — an API key from Google AI Studio with Gemini API access.
   - `ORBIT_AI_MODEL=gemini-2.5-flash` (optional; this is the default).
3. Redeploy the backend after saving the variables.

`GEMINI_API_KEY` stays on the server. It must not be added to Vercel variables, committed to Git, or placed in frontend source files.

## Frontend (Vercel)

1. Set `VITE_API_BASE` to the public URL of the deployed Render backend, for example `https://your-service.onrender.com`.
2. Redeploy the frontend.
3. Sign in, add at least one planned task and one routine time, then open **Ask Orbit** and ask a plan-specific question.

If Gemini is not configured or unavailable, Ask Orbit clearly reports that condition rather than returning invented, canned guidance.
