# Dating Advice Backend

Simple TypeScript + Express backend for the Dating Advice project.

Quick start:

```bash
cd backend
npm install
npm run dev
```

API endpoints:
- `GET /api/advice` — list all advice
- `POST /api/advice` — create advice (JSON: `{ author, text, tags? }`)
