"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ollamaChat = ollamaChat;
async function ollamaChat(opts) {
    const { model, messages, system, user, temperature = 0.7 } = opts;
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
    };
    if (typeof opts.maxTokens === "number")
        body.max_tokens = opts.maxTokens;
    const url = (process.env.OLLAMA_URL || "http://localhost:11434/api/chat");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!r.ok) {
            const text = await r.text().catch(() => '<no body>');
            throw new Error(`Ollama error: ${r.status} ${text}`);
        }
        const data = await r.json();
        clearTimeout(timeout);
        const content = data?.choices?.[0]?.message?.content ??
            data?.choices?.[0]?.message ??
            data?.response ??
            "";
        return (typeof content === "string" ? content : String(content)).trim();
    }
    catch (err) {
        const msg = (err && err.name === 'AbortError') ? 'Ollama request timed out' : `Ollama connection failed: ${err && err.message ? err.message : String(err)}`;
        const e = new Error(msg);
        e.code = 'OLLAMA_CONNECTION_FAILED';
        throw e;
    }
    finally {
        clearTimeout(timeout);
    }
}
