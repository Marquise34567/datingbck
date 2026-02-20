import express from 'express';
import cors from 'cors';

const app = express();

/* ---------- CORS CONFIG ---------- */

const allowedOrigins = [
  "https://sparkdd.live",
  "https://www.sparkdd.live",
  "http://localhost:3000",
];

// Allow all vercel preview deployments for this project
function isVercelPreview(origin) {
  return (
    origin &&
    origin.endsWith('.vercel.app') &&
    origin.includes('datingapp-frontend')
  );
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin) || isVercelPreview(origin)) {
        return callback(null, true);
      }

      console.log('❌ CORS blocked:', origin);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// VERY IMPORTANT — handle preflight
app.options('*', cors());

app.use(express.json());

// Health endpoints for Railway
app.get('/', (_req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Dating Advice API running on port ${PORT}`);
});
