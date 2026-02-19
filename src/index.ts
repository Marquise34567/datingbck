import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import os from 'os';
import multer from 'multer';
import { adviceRouter } from './routes/advice';
import { getEntitlements, setPremium, getDailyRemaining } from './entitlements';
import redisClient, { incrementWeeklyUsage, getWeeklyUsage, isTokenPaid, markTokenPaid, setPaid, unsetPaid, isPaid } from './upstash';
import { appendPurchaseRow } from './googleSheets';
import { google } from 'googleapis';

// --- Google Sheets helper ---
function getGoogleAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function appendTestRow() {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const tab = process.env.GOOGLE_SHEET_TAB || 'Sheet1';

  const now = new Date().toISOString();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A:E`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[`test_${Date.now()}`, 'test@example.com', 'cus_TEST', 'cs_TEST', now]],
    },
  });
}

// Ollama config
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llama3.2-vision';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

async function callOllamaChat(body: any) {
  const url = `${OLLAMA_URL.replace(/\/$/, '')}/api/chat`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '<no body>');
    throw new Error(`Ollama /api/chat failed ${res.status}: ${txt}`);
  }
  return res.json();
}

async function callOllamaGenerate(body: any) {
  const url = `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '<no body>');
    throw new Error(`Ollama /api/generate failed ${res.status}: ${txt}`);
  }
  return res.json();
}

function extractTextFromOllamaResponse(resp: any): string {
  try {
    // Flexible extraction depending on response shape
    if (!resp) return '';
    // common shapes: { choices: [{ message: { content: '...' } }] } or { choices: [{ content: '...' }] }
    if (Array.isArray(resp.choices) && resp.choices.length) {
      const c = resp.choices[0];
      if (c.message && (c.message.content || c.message)) {
        return typeof c.message.content === 'string' ? c.message.content : (c.message.content ?? JSON.stringify(c.message));
      }
      if (c.content) return typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
      // some models embed text in c.text or c.output
      if (c.text) return String(c.text);
      if (c.output) return typeof c.output === 'string' ? c.output : JSON.stringify(c.output);
    }
    // fallbacks: resp.output, resp.text
    if (resp.output) return typeof resp.output === 'string' ? resp.output : JSON.stringify(resp.output);
    if (resp.text) return String(resp.text);
    return JSON.stringify(resp);
  } catch (e) {
    return '';
  }
}

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// Important: Stripe webhook needs the raw body. Register the raw parser
// route before the JSON body parser middleware so the raw payload is available.
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = (req.headers['stripe-signature'] || '') as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(400).json({ ok: false, error: 'webhook not configured' });
  try {
    const Stripe = require('stripe');
    const stripeSecretEnv = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
    const stripe = new Stripe(String(stripeSecretEnv), { apiVersion: '2022-11-15' });
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const token = session.client_reference_id || (session.metadata && session.metadata.token) || session.metadata?.token;
      const uid = token || session.client_reference_id || (session.metadata && session.metadata.sessionId) || session.metadata?.uid;
      const customer = session.customer;
      if (uid) {
        try {
          setPremium(uid, true, 'premium');
        } catch (e) {
          console.warn('failed to set premium from webhook', e);
        }
      }

      // mark token paid in Upstash and append to Google Sheet
      try {
        if (token) {
          await markTokenPaid(String(token));
          const subs = session.subscription as any;
          const subscriptionId = subs && subs.id ? subs.id : (session.subscription as string) || null;
          const customerId = String(customer || '');
          const ts = new Date().toISOString();
          await appendPurchaseRow([String(token), String(event.id || ''), customerId, String(subscriptionId || ''), ts]);
        }
      } catch (e) {
        console.warn('failed to mark token paid or append sheet', e);
      }

      if (customer && uid) {
        try {
          const subs = session.subscription as any;
          const periodEndISO = subs && subs.current_period_end ? new Date(subs.current_period_end * 1000).toISOString() : null;
          const subscriptionId = subs && subs.id ? subs.id : (session.subscription as string) || null;
          try {
            const { updateStripeInfo } = require('./entitlements');
            updateStripeInfo(uid, { customerId: String(customer), subscriptionId: subscriptionId, currentPeriodEnd: periodEndISO });
          } catch (e) {
            console.warn('failed to update stripe info', e);
          }
        } catch (e) {
          console.warn('failed to process session subscription info', e);
        }
      }
    }

    if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
      const obj = event.data.object as any;
      const customerId = obj.customer;
      try {
        const { entitlementsStore, updateStripeInfo, setPremium } = require('./entitlements');
        for (const [uid, val] of entitlementsStore) {
          if (val.stripeCustomerId === customerId) {
            updateStripeInfo(uid, { currentPeriodEnd: null });
            setPremium(uid, false, null);
          }
        }
      } catch (e) {
        console.warn('failed to handle subscription deletion', e);
      }
    }

    res.json({ received: true });
  } catch (err: any) {
    console.warn('webhook handling error', err && err.message);
    return res.status(400).json({ ok: false, error: 'invalid webhook event' });
  }
});
// Ensure body parsing is configured before routes and with sane limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// --- TEST ROUTE ---
app.get('/api/debug/sheets-append', async (req, res) => {
  try {
    await appendTestRow();
    res.json({ ok: true, message: 'Appended a test row. Check your Google Sheet.' });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Failed to append row',
      hint:
        'Check env vars + that the sheet is shared with the service account email (Editor).',
    });
  }
});

// Debug route to test Upstash Redis connectivity
app.get('/api/debug/redis', async (req, res) => {
  try {
    const ts = Date.now();
    const key = 'debug:ping';
    const val = `pong_${ts}`;
    await (redisClient as any).set(key, val);
    await (redisClient as any).expire(key, 60);
    const got = await (redisClient as any).get(key);
    return res.json({ ok: true, val: got });
  } catch (e: any) {
    console.warn('redis debug failed', e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Debug routes to manually set/unset/check paid status for a token
app.post('/api/debug/paid/set', express.json(), async (req, res) => {
  const token = String(req.body?.token || '');
  if (!token) return res.status(400).json({ ok: false, error: 'Missing token' });

  await setPaid(token);
  res.json({ ok: true, token, paid: true });
});

app.post('/api/debug/paid/unset', express.json(), async (req, res) => {
  const token = String(req.body?.token || '');
  if (!token) return res.status(400).json({ ok: false, error: 'Missing token' });

  await unsetPaid(token);
  res.json({ ok: true, token, paid: false });
});

app.get('/api/debug/paid/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (!token) return res.status(400).json({ ok: false, error: 'Missing token' });

  const paid = await isPaid(token);
  res.json({ ok: true, token, paid });
});

// Token init endpoint: sets HttpOnly `ae_token` cookie if not present
app.post('/api/token', (req, res) => {
  try {
    const existing = req.cookies && req.cookies.ae_token;
    if (existing) return res.json({ ok: true, token: existing });
    const token = (globalThis.crypto && (globalThis.crypto as any).randomUUID ? (globalThis.crypto as any).randomUUID() : require('crypto').randomBytes(16).toString('hex'));
    const secure = process.env.NODE_ENV === 'production' || (process.env.FORCE_COOKIE_SECURE === 'true');
    res.cookie('ae_token', token, { httpOnly: true, sameSite: 'lax', secure, maxAge: 1000 * 60 * 60 * 24 * 365, path: '/' });
    return res.json({ ok: true, token });
  } catch (e) {
    console.warn('token init failed', e);
    return res.status(500).json({ ok: false, error: 'token_init_failed' });
  }
});

app.use('/api/advice', adviceRouter);

app.get('/api/me/entitlements', (req, res) => {
  const sessionId = (req.query.sessionId as string) || req.headers['x-session-id'] as string;
  if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId required' });
  try {
    const ent = getEntitlements(sessionId);
    const daily = getDailyRemaining(sessionId);
    return res.json({ ok: true, plan: ent?.plan ?? 'free', isPremium: !!ent?.isPremium, dailyLimit: daily.dailyLimit, dailyUsed: daily.dailyUsed, dailyRemaining: daily.dailyRemaining, advanced: !!ent?.isPremium, stripeCustomerId: ent?.stripeCustomerId ?? null, stripeSubscriptionId: ent?.stripeSubscriptionId ?? null, currentPeriodEnd: ent?.currentPeriodEnd ?? null });
  } catch (err) {
    console.warn('entitlements fetch error', err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch entitlements' });
  }
});

// Public entitlements endpoint (alias) for clients
app.get('/api/entitlements', (req, res) => {
  const sessionId = (req.query.sessionId as string) || req.headers['x-session-id'] as string;
  if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId required' });
  try {
    const ent = getEntitlements(sessionId);
    const daily = getDailyRemaining(sessionId);
    return res.json({ ok: true, plan: ent?.plan ?? 'free', isPremium: !!ent?.isPremium, dailyLimit: daily.dailyLimit, dailyUsed: daily.dailyUsed, dailyRemaining: daily.dailyRemaining, advanced: !!ent?.isPremium, stripeCustomerId: ent?.stripeCustomerId ?? null, stripeSubscriptionId: ent?.stripeSubscriptionId ?? null, currentPeriodEnd: ent?.currentPeriodEnd ?? null });
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
  const sessionId = (req.body && ((req.body as any).sessionId || (req.body as any).uid)) || req.headers['x-session-id'];
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
    const token = req.cookies?.ae_token || (req.body && req.body.token) || String(sessionId);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(token || sessionId),
      metadata: { token: String(token || '') },
      success_url: process.env.CHECKOUT_RETURN || `http://localhost:${process.env.PORT || 5173}/?session=success`,
      cancel_url: process.env.CHECKOUT_RETURN || `http://localhost:${process.env.PORT || 5173}/?session=cancel`,
    });
    return res.json({ ok: true, url: session.url });
  } catch (err) {
    console.warn('checkout create failed', err);
    return res.status(500).json({ ok: false, error: 'Failed to create checkout' });
  }
});

// Known-good Stripe checkout route: /api/billing/create-checkout-session
app.post('/api/billing/create-checkout-session', async (req, res) => {
  try {
    const priceId = process.env.STRIPE_PRICE_ID;
    const appUrl = process.env.APP_URL;

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
    }
    if (!priceId) {
      return res.status(500).json({ error: 'Missing STRIPE_PRICE_ID' });
    }
    if (!appUrl) {
      return res.status(500).json({ error: 'Missing APP_URL' });
    }

    const StripeLib = (await import('stripe')).default;
    const stripe = new StripeLib(process.env.STRIPE_SECRET_KEY! as string, ({ apiVersion: '2024-06-20' } as any));

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/upgrade`,
    });

    return res.json({ url: session.url });
  } catch (e: any) {
    return res.status(500).json({
      error: e?.message || 'Stripe checkout creation failed',
      type: e?.type,
    });
  }
});



// Legacy webhook path for compatibility
app.post('/api/webhook', (req, res) => res.status(404).json({ ok: false, error: 'use /api/webhook/stripe' }));

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

// Health check for Ollama: returns available models/tags
app.get('/api/health/ollama', async (req, res) => {
  try {
    const url = `${OLLAMA_URL.replace(/\/$/, '')}/api/tags`;
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text().catch(() => '<no body>');
      return res.status(502).json({ ok: false, error: 'ollama_unreachable', detail: t });
    }
    const data = await r.json().catch(() => null);
    return res.json({ ok: true, models: data });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: 'failed', message: err && err.message });
  }
});

// One-shot debug route to verify Stripe-related env vars and APP_URL
app.get('/api/debug/stripe-env', (req, res) => {
  res.json({
    hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
    hasPriceId: !!process.env.STRIPE_PRICE_ID,
    appUrl: process.env.APP_URL || null,
  });
});

// Generic debug env route (useful for Railway / container checks)
app.get('/api/debug/env', (req, res) => {
  res.json({
    hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
    hasPriceId: !!process.env.STRIPE_PRICE_ID,
    appUrl: process.env.APP_URL || null,
    nodeEnv: process.env.NODE_ENV || null,
  });
});

// Debug cookies route to confirm cookie-parser is working
app.get('/api/debug/cookies', (req, res) => {
  res.json({ cookies: req.cookies || null });
});

// Basic health check for quick verification
app.get('/api/debug/health', (req, res) => {
  res.json({ ok: true });
});

// Root/info route
app.get('/', (req, res) => {
  res.send('Dating Advice API is running. Use /api/* endpoints.');
});

// Screenshot coach endpoint
app.post('/api/screenshot-coach', upload.single('image'), async (req, res) => {
  try {
    // multer will populate req.file
    const file = (req as any).file as any | undefined;
    if (!file) return res.status(400).json({ ok: false, error: 'file_required' });

    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.mimetype)) return res.status(400).json({ ok: false, error: 'invalid_mime' });

    // enforce size (multer also enforces limits)
    if (file.size > 8 * 1024 * 1024) return res.status(400).json({ ok: false, error: 'file_too_large' });

    const note = (req.body && (req.body as any).note) ? String((req.body as any).note) : '';

    const base64 = file.buffer.toString('base64');
    // Send images as data URIs so vision-capable models reliably recognize them
    const imageDataUri = `data:${file.mimetype};base64,${base64}`;

    const systemPrompt = `You are Sparkd, a dating coach who talks like a real friend: confident, warm, slightly playful, never robotic. You read screenshots of texts/DMs and give concrete, specific advice. Treat any image provided as if the text in that image had been pasted directly — extract and interpret the text and speaker turns. You always:
  1) Briefly summarize what’s happening
  2) Tell the user what the other person’s vibe/intent seems to be (if inferable)
  3) Give a clear plan (what to do next + timing)
  4) Provide 1 best copy/paste reply + 2 alternate replies in different tones (playful/direct)
  5) Give 1 short warning (what NOT to say/do)
  Only ask one clarifying question if absolutely necessary.
  If the screenshot shows abuse/harassment or unsafe behavior, prioritize safety and boundaries.`;

    const userContent = `User note: ${note}\n\nYou will receive a screenshot image; extract the textual conversation and speaker turns from the image and treat that extracted text exactly like pasted text from the user. Read the screenshot and coach me. Reply in natural text and output a JSON object with keys: summary, vibe, advice, best_reply, alt_replies (array of 2), warning, question (or null). Keep replies copy/paste ready.`;

    const body = {
      model: OLLAMA_VISION_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent, images: [imageDataUri] }
      ],
      stream: false,
    };

    let resp: any;
    try {
      // Debug: log the system prompt being sent to Ollama to ensure prompt changes are applied
      try { console.log("SYSTEM PROMPT BEING SENT:"); console.log(systemPrompt); } catch (e) { /* ignore logging errors */ }
      resp = await callOllamaChat(body);
    } catch (e) {
      // fallback to /api/generate
      try {
        try { console.log("SYSTEM PROMPT BEING SENT (generate):"); console.log(systemPrompt); } catch (e) { /* ignore logging errors */ }
        resp = await callOllamaGenerate(body);
      } catch (e2) {
        console.warn('ollama both endpoints failed', e, e2);
        return res.status(502).json({ ok: false, error: 'ollama_failed', message: String(e) });
      }
    }

    const text = extractTextFromOllamaResponse(resp) || '';
    // log a snippet of the model output to help debug why JSON parsing may fail
    try { console.debug('screenshot-coach: model output (snippet):', String(text).substring(0,1000)); } catch (e) { /* ignore */ }

    // Try to parse JSON out of the model output
    let parsed: any = null;
    try {
      parsed = JSON.parse(text.trim());
    } catch (_) {
      // attempt to extract first JSON object inside the text
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch (_) { parsed = null; }
      }
    }

    const out = {
      ok: true,
      summary: parsed?.summary ?? (text.substring(0, 400)),
      vibe: parsed?.vibe ?? null,
      advice: parsed?.advice ?? null,
      best_reply: parsed?.best_reply ?? null,
      alt_replies: parsed?.alt_replies ?? (Array.isArray(parsed?.alt_replies) ? parsed.alt_replies : (parsed?.alternates || [])),
      warning: parsed?.warning ?? null,
      question: parsed?.question ?? null,
      raw: resp,
    };

    return res.json(out);
  } catch (err: any) {
    console.warn('screenshot-coach error', err);
    return res.status(500).json({ ok: false, error: 'server_error', message: err && err.message });
  }
});

// POST /api/chat - always call Ollama and return raw reply
app.post('/api/chat', express.json(), async (req, res) => {
  try {
    const message = String(req.body?.message || req.body?.text || req.body?.userMessage || '');
    const mode = String(req.body?.mode || 'dating');
    if (!message.trim()) return res.status(400).json({ ok: false, error: 'EMPTY_INPUT' });

    const model = process.env.OLLAMA_MODEL || 'gemma3:4b';
    const systemPrompt = `You are Sparkd, a helpful dating coach. Reply concisely with situation-aware, empathetic, and actionable advice. Match the user's requested mode (${mode}).`;

    const body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      temperature: 0.9,
      top_p: 0.9,
      repeat_penalty: 1.22,
      num_ctx: 4096,
      stream: false,
    };

    console.log('OLLAMA model:', model);
    console.log('USER:', message.slice(0, 1000));

    let resp: any;
    try {
      resp = await callOllamaChat(body);
    } catch (e) {
      try {
        resp = await callOllamaGenerate(body);
      } catch (e2) {
        console.error('[api/chat] ollama call failed', e, e2);
        return res.status(500).json({ ok: false, error: 'OLLAMA_UNREACHABLE', details: String(e) });
      }
    }

    // Per spec: only return the text content so the frontend can't render raw JSON
    const reply = (resp && resp.message && (typeof resp.message.content === 'string' ? resp.message.content : resp.message.content ?? '')) || '';
    console.log('OLLAMA reply (trimmed):', String(reply).slice(0, 300));

    return res.json({ ok: true, reply });
  } catch (err: any) {
    console.error('[api/chat] error', err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// POST /api/chat/init - generate a warm, human opener using Ollama (gemma3:4b)
app.post('/api/chat/init', express.json(), async (req, res) => {
  try {
    const systemPrompt = `You are Sparkdd, a modern dating coach.\nYour job is to start the conversation in a natural, warm, human way.\nDo NOT give advice yet.\nAsk one engaging question that invites the user to explain their situation.\nKeep it short (1–2 sentences max).\nNo generic therapy tone.\nNo clichés.\nVary the style every time.\nAvoid repeating the same structure across sessions.`;

    const body = {
      model: 'gemma3:4b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Start the session with a short, human opener. Ask one question only.' }
      ],
      temperature: 0.95,
      top_p: 0.9,
      repeat_penalty: 1.25,
      num_ctx: 4096,
      stream: false,
    } as any;

    let resp: any;
    try {
      resp = await callOllamaChat(body);
    } catch (e) {
      try {
        resp = await callOllamaGenerate(body);
      } catch (e2) {
        console.error('[api/chat/init] ollama call failed', e, e2);
        return res.status(502).json({ ok: false, error: 'OLLAMA_UNREACHABLE' });
      }
    }

    // Per spec: return only the text content under `reply` so frontend can't render raw JSON
    const reply = (resp && resp.message && (typeof resp.message.content === 'string' ? resp.message.content : resp.message.content ?? '')) || '';
    return res.json({ ok: true, reply });
  } catch (err: any) {
    console.error('[api/chat/init] error', err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Debug route to list Ollama tags/models
app.get('/api/debug/ollama', async (req, res) => {
  try {
    const url = `${OLLAMA_URL.replace(/\/$/, '')}/api/tags`;
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text().catch(() => '<no body>');
      return res.status(502).json({ ok: false, error: 'ollama_unreachable', detail: t });
    }
    const data = await r.json().catch(() => null);
    return res.json({ ok: true, models: data });
  } catch (err: any) {
    console.error('[api/debug/ollama] failed', err);
    return res.status(500).json({ ok: false, error: 'failed', message: err && err.message });
  }
});

const PORT = Number(process.env.PORT) || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dating Advice API listening on 0.0.0.0:${PORT}`);
});
