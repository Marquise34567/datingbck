import { ollamaChat } from './llmOllama';
import { classify, CoachMode } from './coachRouter';
import { buildSystemPrompt, buildUserPrompt } from './coachPrompts';
import { getSessionMemory, setSessionMemory } from './memoryStore';

export type RunOpts = {
  sessionId: string;
  userMessage: string;
  explicitMode?: string;
  advanced?: boolean;
  model?: string;
};

export async function runCoach(opts: RunOpts) {
  const mode = classify(opts.userMessage || '', opts.explicitMode) as CoachMode;
  const sessionMem = getSessionMemory(opts.sessionId || '') || {};
  const memorySummary = Object.keys(sessionMem).length ? Object.entries(sessionMem).map(([k, v]) => `${k}:${String(v)}`).join('\n') : '';

  const system = buildSystemPrompt(mode);
  const user = buildUserPrompt(opts.userMessage || '', memorySummary);

  const model = opts.model || process.env.OLLAMA_MODEL || 'gemma3:4b';
  const temperature = opts.advanced ? 0.9 : 0.8;
  const maxTokens = opts.advanced ? 1024 : 512;

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  const raw = await ollamaChat({ model, messages, temperature, maxTokens });

  // Try to parse JSON; if not JSON, return raw text under `message`
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // ignore
  }

  // Update session memory summary cheaply
  try {
    const prev = sessionMem?.whatHappened ? String(sessionMem.whatHappened) : '';
    const next = (prev + '\n' + (opts.userMessage || '')).slice(-1000);
    setSessionMemory(opts.sessionId || '', { whatHappened: next });
  } catch (e) {
    // ignore
  }

  return { raw, parsed } as any;
}

export default runCoach;
