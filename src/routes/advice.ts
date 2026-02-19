import { Router } from 'express';
import { z } from 'zod';
import { addAdvice, getAllAdvice } from '../store/adviceStore';

const router = Router();

const adviceSchema = z.object({
  author: z.string().min(1),
  text: z.string().min(1),
  tags: z.array(z.string()).optional()
});

router.get('/', (_req, res) => {
  res.json(getAllAdvice());
});

// POST: dual-purpose endpoint
// - If body looks like a persisted advice (author + text) -> keep existing create behavior
// - Otherwise treat as a generation request coming from the frontend and return a coach reply
router.post('/', (req, res) => {
  // Safe, truncated logging for debugging
  console.log('advice body keys:', Object.keys(req.body || {}));
  try {
    const safeBody = JSON.stringify(req.body, (_k, v) => (typeof v === 'string' && v.length > 1000 ? `${v.slice(0, 1000)}...` : v));
    console.log('[api/advice] POST body:', safeBody);
  } catch (e) {
    console.log('[api/advice] POST body: (unserializable)');
  }

  // Accept multiple field names for input text
  const candidateTextFields = ['message', 'text', 'input', 'prompt', 'userMessage'];
  let textValue: string | undefined = undefined;
  let providedField: string | undefined = undefined;
  for (const f of candidateTextFields) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
      providedField = f;
      const v = req.body[f];
      if (typeof v === 'string') {
        textValue = v;
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        // allow coercion of primitive types
        textValue = String(v);
        console.warn(`[api/advice] coerced ${f} from ${typeof v} to string`);
      } else if (v == null) {
        textValue = '';
      } else {
        return res.status(400).json({ ok: false, error: 'invalid_type', details: { field: f, type: typeof v } });
      }
      break;
    }
  }

  const mode = req.body?.mode ?? req.body?.tab ?? req.body?.persona ?? 'dating';

  // If the request is intended to create a persisted advice item, validate and create
  const looksLikeCreate = typeof req.body?.author === 'string' && typeof req.body?.text === 'string';
  if (looksLikeCreate) {
    const parsed = adviceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'validation_failed', details: parsed.error.format() });
    }
    const created = addAdvice(parsed.data);
    return res.status(201).json({ ok: true, created });
  }
  // Generation request path
  try {
    const text = textValue ?? '';
    if (!String(text).trim()) {
      return res.json({
        ok: true,
        message:
          "Hey — I’m here. Quick question: do you want advice, rizz, or strategy? And what’s the vibe?",
        mode,
      });
    }

    // Minimal deterministic reply for now (no LLM integration here)
    let reply = '';
    const short = String(text).trim();
    if (mode === 'rizz') {
      reply = `Rizz reply for: ${short}\n\nKeep it playful and confident.`;
    } else if (mode === 'strategy') {
      reply = `Strategy verdict for: ${short}\n\nShort plan: assess, escalate, follow-up.`;
    } else {
      reply = `Dating advice: ${short}\n\nBe direct, kind, and clear about next steps.`;
    }

    return res.json({ ok: true, message: reply, mode });
  } catch (err: any) {
    console.error('[api/advice] generation error', err);
    return res.status(500).json({ ok: false, error: 'server_error', message: String(err?.message ?? err) });
  }
});

export { router as adviceRouter };
