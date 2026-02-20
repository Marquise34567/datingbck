# Dating Advice (Monorepo)

This workspace contains a Vite + React frontend and a TypeScript + Express backend.

Structure:
- `backend/` — Express API (TypeScript)
- `frontend/` — Frontend app (React, Vite)

Quick start:

Backend:
```bash
cd backend
npm install
npm run dev
```

Frontend (from workspace root):
```bash
cd frontend
npm install
npm run dev -- --host --port 5173
```

API endpoints (backend):
- `GET /api/health` — health check
- `POST /api/advice` — request coaching reply (JSON: `{ sessionId, userMessage, mode }`)

Notes:
- The backend supports `mode` values `dating_advice`, `rizz`, and `strategy` (quick strategist analysis).
- Local Ollama integration is optional and controlled by `USE_OLLAMA` in `backend/.env`.
