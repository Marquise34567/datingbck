export type Entitlements = {
  ok: boolean;
  plan: string | null;
  isPremium: boolean;
  dailyLimit: number | null;
  dailyUsed: number;
  dailyRemaining: number | null;
  advanced: boolean;
};

import { apiFetch, apiUrl } from './api';

export async function fetchEntitlements(sessionId?: string): Promise<Entitlements> {
  try {
    let path = '/api/me/entitlements';
    if (sessionId) path += `?sessionId=${encodeURIComponent(sessionId)}`;
    const url = apiUrl(path);
    const res = await apiFetch(path, { method: 'GET' });
    const text = await res.text();
    try {
      const data = text ? JSON.parse(text) : {};
      return data as Entitlements;
    } catch (e) {
      return { ok: false, plan: null, isPremium: false, dailyLimit: 3, dailyUsed: 0, dailyRemaining: 3, advanced: false };
    }
  } catch (e) {
    // Network error — return a safe default for local dev
    return { ok: true, plan: 'free', isPremium: false, dailyLimit: 3, dailyUsed: 0, dailyRemaining: 3, advanced: false } as Entitlements;
  }
}
