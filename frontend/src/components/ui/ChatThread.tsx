import React, { useEffect, useRef } from 'react';

type Msg = { id: string; role: 'user' | 'assistant'; text: string };

export default function ChatThread({ messages }: { messages: Msg[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const isNearBottom = () => {
    const el = scrollerRef.current;
    if (!el) return true;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance < 120; // px threshold
  };

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const shouldAutoScroll = isNearBottom();
    if (shouldAutoScroll) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length]);

  return (
    <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
      <div className="space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[85%] rounded-3xl px-4 py-3 text-[15px] leading-relaxed shadow-sm whitespace-pre-line ${m.role === 'user' ? 'user-bubble' : 'assistant-bubble'}`}>
              {m.text}
            </div>
          </div>
        ))}
      </div>
      <div ref={endRef} />
    </div>
  );
}
