"use client";

import React, { useEffect } from "react";

export default function UpgradeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* overlay */}
      <button
        aria-label="Close modal"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* centered card */}
      <div className="relative z-10 flex min-h-full items-start justify-center p-4 pt-20">
        <div
          role="dialog"
          aria-modal="true"
          className="w-full max-w-xl rounded-2xl border border-white/10 bg-white shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* header */}
          <div className="flex items-start justify-between p-6 border-b border-zinc-100">
            <div>
              <div className="text-sm font-medium text-zinc-500">Premium</div>
              <h2 className="text-2xl font-semibold text-zinc-900">Upgrade your texting</h2>
              <p className="mt-1 text-sm text-zinc-500">Unlimited replies, tone-aware suggestions, and priority features.</p>
            </div>

            <button
              aria-label="Close"
              onClick={onClose}
              className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100"
            >
              ✕
            </button>
          </div>

          {/* body */}
          <div className="p-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-4xl font-semibold text-zinc-900">$19</div>
                <div className="-mt-1 text-sm text-zinc-500">per month • Cancel anytime</div>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">Most popular</span>
            </div>

            <div className="mt-6 space-y-3 text-sm text-zinc-700">
              <Feature>Unlimited replies + rewrites</Feature>
              <Feature>Tone + intent detection</Feature>
              <Feature>“Make it smoother” slider</Feature>
              <Feature>Date plan + follow-ups</Feature>
            </div>

            <button className="mt-7 w-full rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 px-4 py-3 text-sm font-semibold text-white hover:opacity-95">
              Upgrade to Premium
            </button>

            <button
              onClick={onClose}
              className="mt-3 w-full rounded-xl px-4 py-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
            >
              Not now
            </button>

            <div className="mt-4 text-center text-xs text-zinc-400">Secure checkout • Takes 10 seconds</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-zinc-900 text-white text-[11px]">✓</div>
      <div className="leading-6">{children}</div>
    </div>
  );
}
