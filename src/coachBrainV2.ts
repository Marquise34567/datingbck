import { getHistory, pushTurn, getSessionMemory } from "./memoryStore";
import { ollamaChat } from "./llmOllama";

type Mode = "dating_advice" | "rizz" | "strategy";
type Intent =
  | "greeting"
  | "no_reply"
  | "ask_out"
  | "reply_help"
  | "define"
  | "conflict"
  | "breakup"
  | "apology"
  | "flirt"
  | "general";

function norm(s = "") {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
function hasAny(t: string, words: string[]) {
  return words.some((w) => t.includes(w));
}
function rand<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function clamp(s: string, max = 520) {
  const x = s.trim();
  return x.length > max ? x.slice(0, max - 1).trim() + "…" : x;
}

function detectIntent(tRaw: string): Intent {
  const t = norm(tRaw || "");
  if (!t) return "general";
  if (hasAny(t, ["hi", "hey", "yo", "hello", "wyd", "sup"])) return "greeting";
  if (hasAny(t, ["ghost", "left on read", "not replying", "dry", "ignoring", "not texting"])) return "no_reply";
  if (hasAny(t, ["ask her out", "ask him out", "date", "link", "hang", "pull up", "meet up"])) return "ask_out";
  if (hasAny(t, ["what do i say", "what should i text", "how do i reply", "what do i text back", "respond"])) return "reply_help";
  if (hasAny(t, ["what are we", "exclusive", "situationship", "relationship", "serious"])) return "define";
  if (hasAny(t, ["argue", "fight", "mad", "upset", "disrespect", "attitude"])) return "conflict";
  if (hasAny(t, ["broke up", "left me", "dumped", "breakup", "ended it"])) return "breakup";
  if (hasAny(t, ["sorry", "apologize", "my fault"])) return "apology";
  if (hasAny(t, ["flirt", "rizz", "smooth", "compliment", "game"])) return "flirt";
  return "general";
}

function coachStyle(mode: Mode) {
  if (mode === "rizz") return { openers: ["Say less 😌", "Bet — keep it smooth.", "Aight, short and bold."], vibeWords: ["smooth", "confident"] };
  return { openers: ["Got you.", "Okay — I hear you.", "That’s real."], vibeWords: ["calm", "direct"] };
}

function buildQuickReplies(mode: Mode, intent: string) {
  const dating: Record<string, string[]> = {
    greeting: ["What’s the situation?", "Talk to me — what happened?"],
    no_reply: ["Send: ‘All good — you still down to link this week?’", "Send: ‘You been busy? When you free this week?’"],
    ask_out: ["Send: ‘You free Thu or Sat?’", "Send: ‘Coffee this week?’"],
    reply_help: ["Send me what they said + what you want, I’ll write the exact reply."],
    define: ["Send: ‘I like you — are we building or keeping it casual?’"],
    conflict: ["Keep it short: ‘I don’t want to argue over text. Let’s talk later.’"],
    breakup: ["Protect your peace. Don’t send a novel."],
    apology: ["Acknowledge, take responsibility, and move forward."],
    flirt: ["Send: ‘You got a vibe. When you free?’"],
    general: ["Tell me one sentence — I’ll tell you what to text.", "What’s the goal: date, clarity, or move on?"],
  };
  const rizz = { ...dating };
  return mode === "rizz" ? rizz[intent] || rizz.general : dating[intent] || dating.general;
}

function historyText(sessionId: string) {
  return getHistory(sessionId).map((x) => `${x.role}:${x.text}`).join("\n");
}

function alreadyAsked(h: string, marker: string) {
  return h.includes(marker);
}

function extractMessage(data: unknown): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  const d = data as any;
  return d.message ?? d.reply ?? d.text ?? d.advice ?? (d.error ? `Error: ${d.error}` : "");
}

function badReply(s: string) {
  const lower = (s || "").toLowerCase();
  return (
    lower.includes("that's real") ||
    lower.includes("aight") ||
    lower.includes("say less") ||
    lower.includes("tell me one sentence") ||
    (s || "").length < 20
  );
}

async function llmAssist(opts: { mode: Mode; userMessage: string; sessionId: string; intent: Intent; advanced?: boolean; repairInstruction?: string }) {
  const { mode, userMessage, sessionId, intent, advanced = false } = opts as any;
  const h = getHistory(sessionId).slice(-12);
  const transcript = h.map((x) => `${x.role === "user" ? "USER" : "COACH"}: ${x.text}`).join("\n");

  const baseSystem = `You are Spark — an elite, human dating coach (top 1%). You respond like a real person: warm, sharp, emotionally intelligent, decisive.

NON-NEGOTIABLE RULES:
- Always respond to what the user just said with empathy + a concrete helpful answer.
- Do NOT only ask questions. Ask at most one clarifying question, and only after giving value.
- Never repeat “what’s the situation?” or “tell me what happened?” if the user already told you.
- Don’t be generic. Be specific to their exact message.
- If the user mentions breakup/cheating/rejection/anxiety, acknowledge it directly and validate feelings briefly.
- Give steps + exact words to say. The product is: “what do I text back / what do I do next”.

MODES:
- dating: supportive, emotionally intelligent coaching, boundaries, healing, communication
- rizz: playful, confident texts (respectful; not cringe)
- strategy: decisive plan + next actions + if/then decision tree

RESPONSE FORMAT (ALWAYS):
1) Validate (1–2 lines) — respond to their emotion and situation.
2) Read (2–4 bullets) — what’s likely going on / what it means.
3) Do next (2–5 bullets) — exactly what to do right now.
4) If texting is relevant: give 3 ready-to-send texts (Short / Confident / Closure).
5) One question (optional): only if it changes the advice.

TEXT STYLE: modern, natural, concise. No filler. No manipulation. No harassment.

MEMORY (SESSION): Track: who ended it, why, what happened, user goal, whether they want closure or to move on. Use this context in replies.

Follow these rules strictly; output plain natural language only.`;
  // Replace the previous freeform prompt with a structured JSON-output prompt for the coach stage
  const coachSystem = `You are Sparkd, a modern dating coach. You sound like a real human. You respond to what the user said, not a template.

RULES:
- Start by reflecting what happened + the user's goal in 1–2 sentences.
- Always mirror at least one specific detail from the user's last message in your first 2 sentences. For example: "You got broken up with — that's rough."
- Then give a concrete next move (not generic advice).
- If the user asks "what do I text back", you MUST:
  1) propose 3 ready-to-send texts customized to their situation
  2) ask 1–2 clarifying questions ONLY if needed (e.g., "How well do you know her?")
- Never say "Suggested reply for: (no input)".
- Avoid generic phrases like "be confident"; instead show exact wording.
- Keep it short and punchy.

OUTPUT JSON ONLY (no extra text):
{
  "reply": string,
  "draft_texts": string[],
  "questions": string[],
  "next_steps": string[]
}

Produce only valid JSON. If you cannot answer, return at minimum {"reply":"I couldn't help right now","draft_texts":[],"questions":[],"next_steps":[]}.
`;

  const sessionMem = getSessionMemory(sessionId || "") || {};
  const memLines: string[] = [];
  if (sessionMem.whoEndedIt) memLines.push(`whoEndedIt: ${sessionMem.whoEndedIt}`);
  if (sessionMem.why) memLines.push(`why: ${sessionMem.why}`);
  if (sessionMem.whatHappened) memLines.push(`whatHappened: ${sessionMem.whatHappened}`);
  if (sessionMem.userGoal) memLines.push(`userGoal: ${sessionMem.userGoal}`);
  if (typeof sessionMem.wantsClosure === "boolean") memLines.push(`wantsClosure: ${sessionMem.wantsClosure}`);

  const personaSystem = memLines.length ? `${coachSystem}\n\nSession memory:\n${memLines.join("\n")}` : coachSystem;

  const advancedNote = advanced
    ? "\n\n(Advanced mode: provide deeper step-by-step actions, 4-6 ready-to-send message options with tone labels, and an expanded decision tree.)"
    : "";

  const system = (mode === "strategy" ? `${personaSystem}\n\n(Strategy mode: prioritize big-picture assessment, timeline, and one prioritized move.)` : personaSystem) + advancedNote;

  const historyMessages = h.map((turn) => ({
    role: turn.role === "user" ? "user" : "assistant",
    content: String(turn.text || ""),
  }));

  let finalUserContent = `Mode: ${mode}\n\nLatest user message:\n${userMessage}\n\nPlease produce a JSON object matching the schema EXACTLY (reply, draft_texts, questions, next_steps). Output only valid JSON.`;
  if (opts.repairInstruction) {
    finalUserContent += `\n\nREPAIR INSTRUCTION: ${opts.repairInstruction}`;
  }

  const messages = [
    { role: "system", content: system },
    ...historyMessages,
    { role: "user", content: finalUserContent },
  ];

  const model = process.env.OLLAMA_MODEL || "llama3.1";
  const maxTokens = advanced ? 1024 : 256;
  const raw = await ollamaChat({ model, messages, temperature: advanced ? 0.35 : 0.25, maxTokens });
  return raw as unknown;
}

export async function coachBrainV2(body: { sessionId: string; userMessage: string; mode?: Mode; advanced?: boolean }): Promise<{ message: string }> {
  const sessionId = body.sessionId as string;
  const advanced = !!(body as any).advanced;
  const mode: Mode = body.mode === "rizz" ? "rizz" : body.mode === "strategy" ? "strategy" : "dating_advice";
  const msg = (body.userMessage || "").trim();
  const intent = detectIntent(msg);
  const style = coachStyle(mode);
  const hText = historyText(sessionId);

  const useLLM = process.env.USE_OLLAMA === "true";

  let reply = "";

  if (useLLM) {
    try {
      const raw = String(await llmAssist({ mode, userMessage: msg, sessionId, intent, advanced }));
      // raw should be JSON per system instruction — try to parse
      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // not JSON — fall back to plain text extraction
      }

      if (parsed && typeof parsed.reply === 'string') {
        // validate reply and optionally repair
        if (badReply(parsed.reply)) {
          try {
            const repairInstruction = "Rewrite the reply to be warm, human, and specific. No slang. Start with a compassionate sentence. Provide actionable steps and 3 draft texts if texting is relevant. Return valid JSON only.";
            const raw2 = String(await llmAssist({ mode, userMessage: msg, sessionId, intent, advanced, repairInstruction }));
            let parsed2: any = null;
            try {
              parsed2 = JSON.parse(raw2);
            } catch (e) {
              // ignore
            }
            if (parsed2 && typeof parsed2.reply === 'string') {
              reply = parsed2.reply.trim();
              return { message: reply, ...(parsed2 ? { coach: parsed2 } as any : {}) } as any;
            }
          } catch (e) {
            // repair attempt failed — fall back to original parsed
          }
        }

        reply = parsed.reply.trim();
        // attach coach object to return shape via message+coach mapping (caller can use coach)
        return { message: reply, ...(parsed ? { coach: parsed } as any : {}) } as any;
      }

      reply = extractMessage(raw) || "";
      if (reply) reply = reply.split(/\n{2,}/).map((s) => s.trim()).join("\n\n");
    } catch (err) {
      console.warn("llmAssist error:", (err as any)?.message || err);
      reply = "";
    }
  }

  if (!reply) {
    const options = buildQuickReplies(mode, intent);
    const askedForLastMessage = alreadyAsked(hText, "Drop the last message") || alreadyAsked(hText, "Send me what they said") || alreadyAsked(hText, "What did they say last");

    if (intent === "reply_help" && askedForLastMessage) {
      reply = mode === "rizz" ? `${rand(style.openers)}\n\nSend: “I’m down — when you free this week?”` : `${rand(style.openers)}\n\nSend: “I’m down — what day works for you this week?”`;
    } else {
      reply = `${rand(style.openers)}\n\n${rand(options)}`;
    }

    if (!askedForLastMessage && intent === "no_reply" && !alreadyAsked(hText, "How long has it been")) {
      reply += `\n\nHow long has it been since they last replied?`;
    }
  }

  const out = clamp(reply || "");
  if (!out) return { message: "Sorry, I couldn't generate a reply right now." };
  return { message: out };
}
