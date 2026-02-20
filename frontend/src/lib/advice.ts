export type AdviceResponse = {
  message?: string;
  insights?: any;
  strategy?: { headline?: string; why?: string; do?: string[]; dont?: string[] };
  replies?: Record<string, string[]>;
  datePlan?: any;
};

export async function fetchAdvice(payload: any): Promise<any> {
  // Try to call the backend at the relative `/api/advice` endpoint.
  // If the network request fails (no backend running), fall back to a mock response.
  // If the backend responds with a non-2xx status, rethrow the structured error
  // so the UI can react (e.g. DAILY_LIMIT 429).
  try {
    // Normalize fields the backend accepts (message / text / input)
    const rawMode = payload?.mode ?? payload?.tab;
    const normalizedMode = rawMode === 'dating_advice' ? 'dating' : rawMode;

    // send `text` consistently so backend validation sees it
    const body = {
      text: payload?.message ?? payload?.text ?? payload?.userMessage ?? payload?.input ?? '',
      mode: normalizedMode,
      conversation: payload?.conversation,
      sessionId: payload?.sessionId,
      situation: payload?.situation,
      goal: payload?.goal,
      tone: payload?.tone,
    };

    const envMeta: any = (import.meta as any).env || {};
    const API_BASE = (envMeta.VITE_API_BASE || envMeta.NEXT_PUBLIC_API_BASE || '').trim();
    const url = API_BASE ? `${API_BASE.replace(/\/$/, '')}/api/chat` : `/api/chat`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: body.text, mode: body.mode, sessionId: body.sessionId, tone: body.tone }),
      credentials: 'include',
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const errMsg = (data?.error && String(data.error)) || (data?.message && String(data.message)) || `Request failed (${res.status})`;
      throw new Error(errMsg);
    }

    // If backend signals a paywall, return it to the caller for UI handling
    if (data?.paywall) {
      return data;
    }

    const reply = (data?.reply || data?.message || data?.advice || '') as string;
    if (!reply || !String(reply).trim()) throw new Error('Empty reply from backend');

    return { message: String(reply), insights: data?.insights, strategy: data?.strategy, replies: data?.replies, datePlan: data?.datePlan, usage: data?.usage };
  } catch (err: any) {
    // Surface real errors to the UI; do not fabricate advice locally
    throw err;
  }
}
