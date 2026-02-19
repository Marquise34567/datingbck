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
app.post('/api/checkout', async (req, res) => {
  const sessionId = (req.body && (req.body as any).sessionId) || req.headers['x-session-id'];
  if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId required' });

  const stripeSecret = process.env.STRIPE_SECRET;
  const priceId = process.env.STRIPE_PRICE_ID || 'price_1T2NLoAgdqex7SFJZCMoi7pv';
  if (!stripeSecret || !priceId) {
    const base = process.env.CHECKOUT_BASE || 'https://checkout.example.com';
    const returnUrl = process.env.CHECKOUT_RETURN || `http://localhost:${process.env.PORT || 5173}`;
    const url = `${base}/?sessionId=${encodeURIComponent(String(sessionId))}&returnUrl=${encodeURIComponent(returnUrl)}`;
    return res.json({ ok: true, url });
  }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeSecret, { apiVersion: '2022-11-15' });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(sessionId),
      success_url: process.env.CHECKOUT_RETURN || `http://localhost:${process.env.PORT || 5173}/?session=success`,
      cancel_url: process.env.CHECKOUT_RETURN || `http://localhost:${process.env.PORT || 5173}/?session=cancel`,
    });
    return res.json({ ok: true, url: session.url });
  } catch (err) {
    console.warn('checkout create failed', err);
    return res.status(500).json({ ok: false, error: 'Failed to create checkout' });
  }
});

// Stripe webhook to confirm subscription completion and set premium entitlement
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = (req.headers['stripe-signature'] || '') as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(400).json({ ok: false, error: 'webhook not configured' });
  try {
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET, { apiVersion: '2022-11-15' });
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const uid = session.client_reference_id || (session.metadata && session.metadata.sessionId);
      if (uid) {
        try {
          setPremium(uid, true, 'premium');
          console.log('Set premium for', uid);
        } catch (e) {
          console.warn('failed to set premium from webhook', e);
        }
      }
    }
    res.json({ received: true });
  } catch (err: any) {
    console.warn('webhook handling error', err && err.message);
    return res.status(400).json({ ok: false, error: 'invalid webhook event' });
  }
});

// Premium-only support route (dev): accessible only to premium users
app.post('/api/support', (req, res) => {
  const sessionId = (req.body && (req.body as any).sessionId) || req.headers['x-session-id'];
  if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId required' });
  try {
    const ent = getEntitlements(String(sessionId));
    if (!ent || !ent.isPremium) return res.status(403).json({ ok: false, error: 'premium_required' });
    return res.json({ ok: true, message: 'Priority support request received. We will respond shortly (dev stub).' });
  } catch (err) {
    console.warn('support error', err);
    return res.status(500).json({ ok: false, error: 'support_failed' });
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
