import { apiFetch, apiUrl } from './api';

export async function createCheckoutSession(sessionId?: string) {
  const r = await apiFetch('/billing/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    console.error('checkout backend error:', data);
    throw new Error(data?.error || 'Checkout creation failed');
  }

  if (!data?.url) throw new Error('No checkout url returned');
  return data.url as string;
}
