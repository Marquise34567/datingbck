export async function ollamaChat(opts: {
  model: string;
  // Either provide `messages` array (preferred), or `system`+`user` for backward
  // compatibility. `messages` should be [{role: 'system'|'user'|'assistant', content: string}, ...]
  messages?: Array<{ role: string; content: string }>;
  system?: string;
  user?: string;
  temperature?: number;
  maxTokens?: number;
}) {
  const { model, messages, system, user, temperature = 0.7 } = opts as any;

  const msgs = Array.isArray(messages)
    ? messages
    : [
        { role: "system", content: system ?? "" },
        { role: "user", content: user ?? "" },
      ];

  const body = {
    model,
    messages: msgs,
    temperature,
    stream: false,
  } as any;
  if (typeof (opts as any).maxTokens === "number") body.max_tokens = (opts as any).maxTokens;

  const r = await fetch(process.env.OLLAMA_URL || "http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Ollama error: ${r.status} ${text}`);
  }

  const data: any = await r.json();

  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.message ??
    data?.response ??
    "";

  return (typeof content === "string" ? content : String(content)).trim();
}
