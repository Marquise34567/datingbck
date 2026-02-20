"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import { fetchAdvice } from "../lib/advice";
import { apiFetch } from "../lib/api";
import Button from "./ui/Button";
import Composer from "./ui/Composer";
import { createCheckoutSession } from "../lib/checkout";

type Msg = { id: string; role: "user" | "assistant"; text: string; image?: string };

// Quick actions removed per request

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function PremiumDatingAdvicePage() {
  
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isPremium, setIsPremium] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [tone, setTone] = useState<string>('Calm');
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [mode, setMode] = useState<"dating_advice" | "rizz" | "strategy">("dating_advice");
  const [sessionId] = useState(() => (crypto as any).randomUUID());

  const canSend = useMemo(() => input.trim().length > 0, [input]);
  const placeholders = [
    "She said 'lol sure' — what does that mean?",
    'He hasn\'t replied in 2 days.',
    'How do I ask her out without sounding try-hard?',
    'Are we exclusive or not?',
  ];
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  useEffect(() => {
    if (input.trim().length > 0) return;
    const id = setInterval(() => setPlaceholderIndex((i) => (i + 1) % placeholders.length), 3200);
    return () => clearInterval(id);
  }, [input]);
  const placeholderText = input.trim().length > 0 ? '' : placeholders[placeholderIndex];
  function scrollToBottom() {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }

  useEffect(() => {
    // auto-scroll on new messages
    scrollToBottom();
  }, [messages]);

  // On first mount: ensure token, then fetch opener + usage info
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // ensure cookie token exists
        await apiFetch('/token', { method: 'POST' });

        const r = await apiFetch('/chat/init', { method: 'POST' });
        const data = await r.json().catch(() => null);
        if (cancelled) return;
        if (!data || !data.ok) throw new Error(data?.error || 'init failed');
        const replyText = typeof data.reply === 'string' ? data.reply.trim() : '';
        setMessages([{ id: crypto.randomUUID(), role: 'assistant', text: replyText || 'Hey — something glitched. Refresh and try again.' }]);
        setIsPremium(Boolean(data?.usage?.isPremium));
        setRemaining(data?.usage?.remaining ?? null);
      } catch (e) {
        if (cancelled) return;
        setMessages([{ id: crypto.randomUUID(), role: 'assistant', text: 'Hey — something glitched. Refresh and try again.' }]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function formatAdviceToText(result: any) {
    // Prefer server-provided single-message response
    if (typeof result?.message === "string" && result.message.trim().length > 0) {
      return result.message;
    }

    // Fallback: stringify minimal parts if message absent
    const headline = result?.strategy?.headline ? `${result.strategy.headline}\n` : "";
    const why = result?.strategy?.why ? `${result.strategy.why}\n` : "";
    const pick = result?.replies?.confident?.[0] || result?.replies?.playful?.[0] || result?.replies?.sweet?.[0] || "";
    return `${headline}${why}${pick}`.trim();
  }

  async function pushUser(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const conversation = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-12)
        .map((m) => ({ from: m.role === "user" ? "me" : "them", text: m.text }));

      const result = await fetchAdvice({
        situation: "General dating conversation",
        goal: "Get the best next message + plan",
        tone: isPremium ? tone : 'Neutral',
        conversation,
        userMessage: trimmed,
        mode,
        sessionId,
      });

      // Handle paywall response (backend signals paywall without HTTP error)
      if (result && result.paywall) {
        // open upgrade modal and do not append assistant message
        setShowModal(true);
        return;
      }

      // update usage if provided
      if (result?.usage) {
        setIsPremium(Boolean(result.usage.isPremium));
        setRemaining(result.usage.remaining ?? null);
      }

      const assistantText = formatAdviceToText(result);

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: assistantText || "I generated advice, but it returned empty.",
        },
      ]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", text: `Error: ${e.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function pushStrategy(text: string) {
    const trimmed = (text || "").trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const conversation = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-12)
        .map((m) => ({ from: m.role === "user" ? "me" : "them", text: m.text }));

      const result = await fetchAdvice({
        situation: "Quick strategist analysis",
        goal: "Fast verdict + next move",
        tone: isPremium ? tone : 'Neutral',
        conversation,
        userMessage: trimmed,
        mode: "strategy",
        sessionId,
      });

      if (result && result.paywall) {
        setShowModal(true);
        return;
      }

      if (result?.usage) {
        setIsPremium(Boolean(result.usage.isPremium));
        setRemaining(result.usage.remaining ?? null);
      }

      const assistantText = formatAdviceToText(result);

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: assistantText || "I generated advice, but it returned empty.",
        },
      ]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", text: `Error: ${e.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpgrade() {
    setCheckoutLoading(true);
    try {
      const url = await createCheckoutSession(sessionId);
      window.open(url, "_blank");
    } catch (e: any) {
      console.error("checkout error", e);
      alert("Failed to start checkout. Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function handleImageUpload(file: File) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: 'Uploaded screenshot', image: url }]);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await apiFetch('/screenshot-coach', { method: 'POST', body: fd });
      const json = await r.json();
      if (!json || !json.ok) {
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: `Error: ${json?.error || 'Unknown'}` }]);
      } else {
        const parts: string[] = [];
        if (json.summary) parts.push(`Summary: ${json.summary}`);
        if (json.vibe) parts.push(`Vibe: ${json.vibe}`);
        if (json.advice) parts.push(`Advice: ${json.advice}`);
        if (json.best_reply) parts.push(`Best reply (copy/paste): ${json.best_reply}`);
        if (json.alt_replies && Array.isArray(json.alt_replies) && json.alt_replies.length) parts.push(`Alternates: ${json.alt_replies.join(' || ')}`);
        if (json.warning) parts.push(`Warning: ${json.warning}`);
        if (json.question) parts.push(`Question: ${json.question}`);
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: parts.join('\n\n') }]);
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: `Error: ${err?.message || String(err)}` }]);
    } finally {
      setUploading(false);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  return (
    <div className="min-h-screen app-bg">
      {/* Top Nav */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-linear-to-br from-white/5 to-white/10 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-linear-to-br from-zinc-950 to-zinc-700 text-white grid place-items-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                <path d="M12 21s-7-4.35-9.2-7.05C-0.1 8.3 5.2 3 8.7 5.6 10.3 6.9 12 9 12 9s1.7-2.1 3.3-3.4C18.8 3 24.1 8.3 21.2 13.95 19 17.65 12 21 12 21z" />
              </svg>
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold gradient-text">Sparkd</div>
              <div className="text-xs text-zinc-500">Modern dating coach</div>
            </div>
          </div>

              <div className="flex items-center gap-2">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                Good
              </span>
              <span className="text-sm text-zinc-500">7.4/10</span>
              <Button size="sm" variant="primary" className="ml-2" onClick={() => setShowModal(true)} disabled={checkoutLoading}>
                {checkoutLoading ? "Opening..." : "Upgrade"}
              </Button>
              {/* Sign-in removed - app no longer uses auth UI */}
            </div>
        </div>
      </header>

      {/* Content */}
        <main className="mx-auto max-w-6xl px-4 py-8 relative">
          <div className="hearts-decor" />
        {/* HeroCard removed */}

        {/* Main layout */}
        <section className="mt-10 grid gap-6 lg:grid-cols-[1fr_380px]">
          {/* Chat panel */}
          <div className="rounded-3xl border border-zinc-200 bg-white premium-shadow elevated overflow-hidden">
            {/* Chat header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-linear-to-br from-zinc-950 to-zinc-700 text-white grid place-items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 2v3" />
                    <path d="M12 19v3" />
                    <path d="M4.2 4.2L6 6" />
                    <path d="M18 18l1.8 1.8" />
                    <path d="M2 12h3" />
                    <path d="M19 12h3" />
                    <path d="M4.2 19.8L6 18" />
                    <path d="M18 6l1.8-1.8" />
                    <path d="M12 7a5 5 0 100 10 5 5 0 000-10z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold">Sparkd</div>
                  <div className="text-xs text-zinc-500">Premium advice</div>
                </div>
              </div>
              <div className="text-xs text-zinc-500">Online</div>
            </div>

            {/* Messages */}
            <div
              ref={listRef}
              className="chat-scroll px-4 py-4"
            >
              <div className="space-y-3">
                {messages.map((m) => (
                  <div key={m.id} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={cx("max-w-[85%] rounded-3xl px-4 py-3 text-[15px] leading-relaxed shadow-sm whitespace-pre-line", m.role === "user" ? "user-bubble" : "assistant-bubble")}>
                      {m.text}
                    </div>
                  </div>
                ))}
                {/* bottom anchor for smooth autoscroll */}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Quick actions removed */}

            {/* Composer */}
            <div className="border-t border-zinc-100 bg-white px-4 py-4">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Composer
                    mode={mode}
                    setMode={(m) => setMode(m as 'dating_advice' | 'rizz' | 'strategy')}
                    input={input}
                    setInput={(s) => setInput(s)}
                    onSend={(t) => pushUser(t)}
                    onQuickAnalyze={(t) => pushStrategy(t)}
                    /* Image upload disabled (coming soon) */
                    loading={loading}
                      placeholder={placeholderText}
                      isPremium={isPremium}
                      selectedTone={tone}
                      setTone={(t) => setTone(t)}
                  />
                </div>
              </div>
            </div>
          </div>
          {/* Remaining quota */}
          <div className="mt-2 text-sm text-zinc-500">
            {isPremium ? (
              <span className="font-semibold">Premium: unlimited replies</span>
            ) : (
              <span>{remaining === null ? 'Replies left: —' : `${remaining} replies left today`}</span>
            )}
          </div>

          {/* Side panel: show only after conversation is finished */}
          {showInsights ? (
            <aside className="space-y-6">
              <div className="rounded-3xl border border-zinc-200 bg-white p-6 premium-shadow elevated">
                <div className="text-sm font-semibold">Conversation Insights</div>
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-4xl font-semibold">7.4</div>
                  <div className="text-right">
                    <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Good
                    </div>
                    <div className="mt-2 text-sm text-zinc-600">Playful</div>
                  </div>
                </div>

                <div className="mt-5 space-y-2 text-sm text-zinc-600">
                  <div className="flex items-center justify-between">
                    <span>Clarity</span>
                    <span className="text-zinc-500">Good</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Confidence</span>
                    <span className="text-zinc-500">Medium</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Momentum</span>
                    <span className="text-zinc-500">High</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-zinc-200 bg-white p-6 premium-shadow elevated">
                <div className="text-sm font-semibold">Suggested Replies</div>
                <div className="mt-4 grid gap-2">
                  {['😄', '😉', '❤️', '🔥'].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => pushUser(`Use this vibe: ${emoji}`)}
                      className="suggested-reply w-full text-left"
                    >
                      <span style={{fontSize:18}}>{emoji}</span>
                      <span style={{marginLeft:12}}>Make it match this vibe</span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          ) : (
            <aside className="space-y-6">
              <div className="rounded-3xl border border-zinc-200 bg-white p-6 premium-shadow elevated">
                <div className="text-sm font-semibold">Conversation in progress</div>
                <p className="mt-3 text-sm text-zinc-600">Finish the conversation to see insights and suggested replies.</p>
                <div className="mt-4">
                  <Button type="button" onClick={() => setShowInsights(true)} className="w-full" variant="primary" size="md">
                    Finish conversation
                  </Button>
                </div>
              </div>
            </aside>
          )}
        </section>

        {/* Premium modal */}
        {showModal && (
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowModal(false)} />

            <div className="relative z-10 flex min-h-full items-center justify-center p-4">
              <div role="dialog" aria-modal="true" className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start p-6">
                  <div className="lg:col-span-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-2xl font-bold">Spark Premium</div>
                        <div className="mt-1 text-sm text-zinc-500">Unlimited conversations, advanced coaching, and priority support.</div>
                      </div>
                      <button className="text-zinc-500" onClick={() => setShowModal(false)}>✕</button>
                    </div>

                    <div className="mt-6 flex items-center gap-6">
                      <div className="text-4xl font-extrabold">$12.99<span className="text-base font-medium text-zinc-400">/mo</span></div>
                      <div className="rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: 'linear-gradient(90deg,#ff7a59,#ff4d8d)' }}>Popular</div>
                    </div>

                    <ul className="mt-6 space-y-3 text-sm text-zinc-700">
                      <li>• Unlimited Spark conversations every day</li>
                      <li>• Advanced, richer coaching replies (more options + deeper steps)</li>
                      <li>• Priority model capacity and faster responses</li>
                      <li>• Tone controls, date plans, and follow-up sequences</li>
                    </ul>

                    <div className="mt-6 text-sm text-zinc-500">Secure checkout by Stripe.</div>
                  </div>

                  <div className="lg:col-span-1">
                    <div className="rounded-xl border border-zinc-100 p-4 shadow-sm bg-linear-to-br from-white to-zinc-50">
                      <div className="text-xs text-zinc-500">Your plan</div>
                      <div className="mt-2 text-lg font-semibold">Spark Premium</div>
                      <div className="mt-3">
                        <Button
                          type="button"
                          className="w-full"
                          variant="primary"
                          size="md"
                          onClick={async () => {
                            try {
                              await handleUpgrade();
                              setShowModal(false);
                            } catch (err) {
                              console.error('checkout error', err);
                            }
                          }}
                          disabled={checkoutLoading}
                        >
                          {checkoutLoading ? 'Starting checkout…' : 'Upgrade & Checkout'}
                        </Button>
                      </div>
                      <div className="mt-3 text-xs text-zinc-400">No commitment — cancel anytime.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <footer className="mt-10 text-center text-xs text-zinc-400">
          © {new Date().getFullYear()} Sparkd • Premium UI (backend coming next)
        </footer>
      </main>
    </div>
  );
}
