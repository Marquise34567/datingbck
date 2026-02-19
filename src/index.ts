import express from 'express';
import cors from 'cors';
import os from 'os';
import { adviceRouter } from './routes/advice';
import { getEntitlements, setPremium, getDailyRemaining } from './entitlements';

const app = express();

app.use(cors());
// Ensure body parsing is configured before routes and with sane limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/advice', adviceRouter);

app.get('/api/me/entitlements', (req, res) => {
  const sessionId = (req.query.sessionId as string) || req.headers['x-session-id'] as string;
  if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId required' });
  try {
    const ent = getEntitlements(sessionId);
    const daily = getDailyRemaining(sessionId);
    return res.json({ ok: true, plan: ent?.plan ?? 'free', isPremium: !!ent?.isPremium, dailyLimit: daily.dailyLimit, dailyUsed: daily.dailyUsed, dailyRemaining: daily.dailyRemaining, advanced: !!ent?.isPremium });
  } catch (err) {
    console.warn('entitlements fetch error', err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch entitlements' });
  }
});

app.post('/api/admin/set-premium', (req, res) => {
  const { uid, isPremium } = req.body || {};
  if (!uid) return res.status(400).json({ ok: false, error: 'uid required' });
  try {
    setPremium(uid, !!isPremium);
    return res.json({ ok: true, uid, isPremium: !!isPremium });
  } catch (err) {
    console.warn('set-premium failed', err);
    return res.status(500).json({ ok: false, error: 'Failed to set premium' });
  }
});

// Dev stub: create a checkout session and return a checkout URL.
app.post('/api/checkout', (req, res) => {
  const sessionId = (req.body && req.body.sessionId) || req.headers['x-session-id'];
  if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId required' });
  try {
    const base = process.env.CHECKOUT_BASE || 'https://checkout.example.com';
    const returnUrl = process.env.CHECKOUT_RETURN || `http://localhost:${process.env.PORT || 5173}`;
    const url = `${base}/?sessionId=${encodeURIComponent(String(sessionId))}&returnUrl=${encodeURIComponent(returnUrl)}`;
    return res.json({ ok: true, url });
  } catch (err) {
    console.warn('checkout create failed', err);
    return res.status(500).json({ ok: false, error: 'Failed to create checkout' });
  }
});

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';

app.listen(port, host, () => {
  const interfaces = os.networkInterfaces();
  let networkAddress: string | null = null;
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        networkAddress = `http://${iface.address}:${port}`;
        break;
      }
    }
    if (networkAddress) break;
  }

  const localAddress = `http://localhost:${port}`;
  if (networkAddress) {
    console.log(`Dating Advice API listening on ${localAddress} (network: ${networkAddress})`);
  } else {
    console.log(`Dating Advice API listening on ${localAddress}`);
  }
});
