import { Router } from 'express';
import { z } from 'zod';
import { addAdvice, getAllAdvice } from '../store/adviceStore';
import { coachBrainV2 } from '../coachBrainV2';
import { runCoach } from '../coachScaffold';
import { getEntitlements, incrementSparkCount, getDailyRemaining, getWeeklyRemaining, incrementConversationCount } from '../entitlements';
import { getWeeklyUsage, incrementWeeklyUsage, isTokenPaid } from '../upstash';
import { pushTurn, setSessionMemory } from '../memoryStore';

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
router.post('/', async (req, res) => {
  // Safe, truncated logging for debugging
  if (process.env.NODE_ENV !== 'production') {
    console.log('advice body keys:', Object.keys(req.body || {}));
    try {
      const safeBody = JSON.stringify(req.body, (_k, v) => (typeof v === 'string' && v.length > 1000 ? `${v.slice(0, 1000)}...` : v));
      console.log('[api/advice] POST body:', safeBody);
    } catch (e) {
      console.log('[api/advice] POST body: (unserializable)');
    }
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
  let requestToken: string | null = null;

  // Short debug logging for one day to help trace empty-input issues
    try {
      // Enforce weekly usage via Upstash Redis if available.
      let token = '';
      try {
        const tokenFromCookie = (req.cookies && (req.cookies as any).ae_token) || req.headers['x-session-id'] || req.body?.sessionId || req.body?.uid;
        token = String(tokenFromCookie || '');
        requestToken = token || null;
        if (token) {
          const paid = await isTokenPaid(token);
          if (!paid) {
            const used = await getWeeklyUsage(token);
            if (used !== null && used >= 3) {
              return res.status(429).json({ ok: false, code: 'WEEKLY_LIMIT', message: 'Free users are limited to 3 conversations per week. Upgrade to Premium for unlimited access.' });
            }
          }
        }
      } catch (e) {
        console.warn('upstash usage check failed', e);
      }
    console.log('[advice] text length:', String(textValue ?? '').length, 'mode:', mode);
  } catch (e) {
    /* ignore */
  }

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
    let text = String(textValue ?? '');
    // normalize
    text = text.trim();

    // Input validation: reject empty input explicitly
    if (!text) {
      return res.status(400).json({ ok: false, error: 'EMPTY_INPUT' });
    }

    // Helper: simple router analysis to decide if we need clarifying questions
    type RouterOut = {
      intent: 'text_reply' | 'venting' | 'strategy' | 'confidence' | 'date_plan' | 'other';
      needs_clarification: boolean;
      clarifying_questions: string[];
      tone: 'warm' | 'confident' | 'playful' | 'calm';
      key_facts: string[];
      assumptions: string[];
    };

    function analyzeRouter(inp: string, conv: any): RouterOut {
      const t = (inp || '').toLowerCase();
      const facts: string[] = [];
      const assumptions: string[] = [];
      let intent: RouterOut['intent'] = 'other';
      let tone: RouterOut['tone'] = 'warm';

      if (/break\b|broke up|dump(ed)?|ending/.test(t)) {
        intent = 'venting';
        facts.push('possible_breakup');
        tone = 'calm';
      } else if (/what do i text|how do i text|what should i (say|text)|text back/.test(t)) {
        intent = 'text_reply';
        tone = /rizz|smooth|flirt/.test(t) ? 'playful' : 'confident';
      } else if (/date|plan|where to meet|what should i do/.test(t)) {
        intent = 'date_plan';
        tone = 'confident';
      } else if (/anxious|nervous|upset|sad|depressed/.test(t)) {
        intent = 'confidence';
        tone = 'calm';
      } else if (/strategy|plan|next move/.test(t)) {
        intent = 'strategy';
        tone = 'confident';
      }

      // Check for obvious key facts in the latest message
      if (/ghost|left on read|no reply|not replying/.test(t)) facts.push('no_reply');
      if (/cheat|cheated|cheating/.test(t)) facts.push('possible_cheating');
      if (/sorry|apolog(y|ize)/.test(t)) facts.push('apology');

      // Clarification logic: if user asks how to text back but hasn't provided the other person's message or the user's last message, ask for specifics
      const convHasRecent = Array.isArray(conv) && conv.length > 0;
      const needsClarify = intent === 'text_reply' && !convHasRecent && !/".*"/.test(inp) && !/he|she|they|her|him/.test(inp);

      const clarifying_questions: string[] = [];
      if (needsClarify) {
        clarifying_questions.push('What did they text exactly (copy/paste)?');
        clarifying_questions.push('What did you last say to them?');
        clarifying_questions.push('What outcome do you want: date, clarity, or closure?');
      } else if (intent === 'venting') {
        clarifying_questions.push('Do you want coping steps or a text to send?');
      } else if (intent === 'date_plan') {
        clarifying_questions.push('What kind of date are you imagining (coffee, dinner, activity)?');
      }

      if (!clarifying_questions.length) {
        // keep at most 3
      }

      if (!facts.length) assumptions.push('no_major_flags_detected');

      return {
        intent,
        needs_clarification: needsClarify,
        clarifying_questions: clarifying_questions.slice(0, 3),
        tone,
        key_facts: facts,
        assumptions: assumptions.slice(0, 3),
      };
    }

    function coachResponse(routerOut: RouterOut, inp: string, conv: any, premium = false) {
      // Build coach JSON per required schema
      const replyLines: string[] = [];
      const questions: string[] = [];
      const drafts: string[] = [];
      const nextSteps: string[] = [];

      // Mirror + empathize with an engaging opener that references the user's text
      const shortInp = (inp || '').trim().slice(0, 200);
      if (shortInp) {
        replyLines.push(`You said: "${shortInp}".`);
      }
      // Engaging human opener
      if (/ask(ed)? you out|asked me out|asked me/.test(shortInp.toLowerCase())) {
        replyLines.push("Nice — she asked you out. You must really like her.");
      } else if (routerOut.tone === 'calm') {
        replyLines.push('That sounds really heavy — I hear you.');
      } else {
        replyLines.push('Got it — I hear you.');
      }

      if (routerOut.needs_clarification) {
        // safe default text
        drafts.push("Hey — I want to get this right. Can you tell me exactly what they said?\n(Quick: copy/paste their message)");
        // add clarifying questions
        for (const q of routerOut.clarifying_questions) questions.push(q);
        nextSteps.push('Copy their exact message and paste it in your reply so I can craft a tailored text.');
        return {
          reply: replyLines.join(' '),
          questions,
          draft_texts: drafts,
          next_steps: nextSteps,
          mode_used: mode === 'rizz' ? 'Rizz' : mode === 'strategy' ? 'Strategy' : 'Dating advice',
          confidence: 0.6,
        };
      }

      // No clarification needed: provide immediate value
      replyLines.push('Here are tailored options you can use now.');
      // Drafts depending on premium; label Short/Confident/Playful and keep modern dating tone
      if (premium) {
        drafts.push(`Short: Want to grab coffee tomorrow?`);
        drafts.push(`Confident: Loved our last chat — wanna grab coffee Thu or Sat?`);
        drafts.push(`Playful: You + me + coffee = yes? 😉`);
        drafts.push(`Calm: Been thinking about you — when are you free to meet?`);
        nextSteps.push('Pick one message and send it within the next 24 hours.');
        nextSteps.push('If they reply positively, follow up with a specific time suggestion.');
      } else {
        drafts.push(`Short: Want to grab coffee tomorrow?`);
        drafts.push(`Confident: Hey — are you free this week to grab coffee?`);
        drafts.push(`Playful: Coffee this week? I know a spot you’ll like.`);
        nextSteps.push('Choose one text and send it — keep it short and specific.');
      }

      return {
        reply: replyLines.join(' '),
        questions,
        draft_texts: drafts.slice(0, premium ? 6 : 3),
        next_steps: nextSteps,
        mode_used: mode === 'rizz' ? 'Rizz' : mode === 'strategy' ? 'Strategy' : 'Dating advice',
        confidence: premium ? 0.9 : 0.7,
      };
    }

    // Enforce daily limits based on entitlements (sessionId used as uid in prototype)
    let uid = req.body?.sessionId as string | undefined;
    let ent: any = null;
    // coachResult lives across the entitlements/LLM branch and the fallback branch
    let coachResult: any = null;
    try {
      uid = uid || (req.body?.uid as string);
      ent = getEntitlements(uid);
      const remaining = getDailyRemaining(uid).dailyRemaining;
      const weeklyRemaining = getWeeklyRemaining(uid).weeklyRemaining;
      if (ent && !ent.isPremium && remaining <= 0) {
        return res.status(429).json({ ok: false, code: 'DAILY_LIMIT', message: 'Free users are limited to 3 Spark conversations per day. Upgrade to Premium for unlimited access.' });
      }
      if (ent && !ent.isPremium && weeklyRemaining <= 0) {
        return res.status(429).json({ ok: false, code: 'WEEKLY_LIMIT', message: 'Free users are limited to 3 conversations per week. Upgrade to Premium for unlimited access.' });
      }

      // Run our router analysis
      const routerOut = analyzeRouter(text, req.body?.conversation);

      // If we have an LLM pipeline available, prefer that but shape the output to our coach schema when possible
      coachResult = null;
      if (process.env.USE_OLLAMA === 'true') {
        try {
          const advanced = !!(ent && ent.isPremium);
          const model = process.env.OLLAMA_MODEL || undefined;
          const llmResp = await runCoach({ sessionId: uid || '', userMessage: text, explicitMode: mode as any, advanced, model });
          const plain = (llmResp && llmResp.parsed && llmResp.parsed.reply) || (llmResp && llmResp.raw) || '';
          coachResult = {
            reply: String(plain).split('\n\n')[0] || String(plain),
            questions: routerOut.needs_clarification ? routerOut.clarifying_questions : [],
            draft_texts: ent && ent.isPremium ? [String(plain).slice(0, 200), String(plain).slice(200, 400)].filter(Boolean) : [String(plain).slice(0, 200)].filter(Boolean),
            next_steps: ['Follow the chosen script and check back in.'],
            mode_used: mode === 'rizz' ? 'Rizz' : mode === 'strategy' ? 'Strategy' : 'Dating advice',
            confidence: 0.8,
          };
        } catch (e) {
          console.warn('[api/advice] runCoach mapping failed', e);
          coachResult = null;
        }
      }

      // If no LLM or mapping failed, use deterministic coachResponse
      if (!coachResult) {
        coachResult = coachResponse(routerOut, text, req.body?.conversation, !!(ent && ent.isPremium));
      }

      // If the server is configured to use Ollama, try to call coachBrainV2
      if (process.env.USE_OLLAMA === 'true') {
        try {
          const advanced = !!(ent && ent.isPremium);
          const model = process.env.OLLAMA_MODEL || undefined;
          const resp = await runCoach({ sessionId: uid || '', userMessage: text, explicitMode: mode as any, advanced, model });
          const adviceText = (resp && resp.parsed && resp.parsed.reply) || (resp && resp.raw) || '';
          if (!adviceText || !String(adviceText).trim()) {
            return res.status(502).json({ ok: false, error: 'EMPTY_ADVICE', message: 'Model returned empty output' });
          }

          try {
            if (uid) pushTurn(uid, { role: 'user', text, ts: Date.now() });
          } catch (e) {
            console.warn('push user turn failed', e);
          }

          try {
            if (uid) pushTurn(uid, { role: 'coach', text: adviceText, ts: Date.now() });
          } catch (e) {
            console.warn('push coach turn failed', e);
          }

          try {
            if (!(ent && ent.isPremium)) {
              incrementConversationCount(uid, 1);
              try {
                if (requestToken) incrementWeeklyUsage(requestToken);
              } catch (e) {
                console.warn('incrementWeeklyUsage failed', e);
              }
            }
          } catch (e) {
            console.warn('increment conversation count failed', e);
          }

          try {
            setSessionMemory(uid, { whatHappened: String(adviceText).slice(0, 600) });
          } catch (e) {
            console.warn('set session memory failed', e);
          }

          const coachPayload = coachResult || { reply: adviceText };
          return res.json({ ok: true, advice: adviceText, mode, coach: coachPayload });
        } catch (e: any) {
          console.warn('[api/advice] runCoach error:', e?.message ?? e);
        }
      }
    } catch (err) {
      console.warn('entitlements check error', err);
    }
    // If we reach here, coachResult is ready
    try {
      if (uid && !(ent && ent.isPremium)) {
        incrementConversationCount(uid, 1);
        try {
          if (requestToken) incrementWeeklyUsage(requestToken);
        } catch (e) {
          console.warn('incrementWeeklyUsage failed', e);
        }
      }
    } catch (e) {
      console.warn('increment conversation count failed', e);
    }

    // Persist simple memory and turns
    try {
      if (uid) pushTurn(uid, { role: 'user', text, ts: Date.now() });
    } catch (e) {
      console.warn('push user turn failed', e);
    }

    try {
      if (uid) pushTurn(uid, { role: 'coach', text: (coachResult && coachResult.reply) || '', ts: Date.now() });
    } catch (e) {
      console.warn('push coach turn failed', e);
    }

    try {
      if (uid) setSessionMemory(uid, { whatHappened: ((coachResult && coachResult.reply) || '').slice(0, 600) });
    } catch (e) {
      console.warn('set session memory failed', e);
    }

    const finalAdvice = (coachResult && coachResult.reply) || '';
    if (!finalAdvice || !String(finalAdvice).trim()) {
      return res.status(502).json({
        ok: false,
        error: 'EMPTY_ADVICE',
        message: 'Model returned empty output',
      });
    }

    return res.json({ ok: true, advice: finalAdvice, mode, coach: coachResult });
  } catch (err: any) {
    console.error('[api/advice] generation error', err);
    return res.status(500).json({ ok: false, error: 'server_error', message: String(err?.message ?? err) });
  }
});

export { router as adviceRouter };
