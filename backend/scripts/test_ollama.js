(async () => {
  try {
    const body = {
      model: 'gemma3:4b',
      messages: [
        { role: 'system', content: 'You are Sparkd, a helpful dating coach. Reply concisely with situation-aware, empathetic, and actionable advice.' },
        { role: 'user', content: "He hasn't replied in 3 days, what should I text?" }
      ],
      temperature: 0.9,
      top_p: 0.9,
      repeat_penalty: 1.22,
      num_ctx: 4096,
      stream: false,
    };

    const res = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    console.log('status', res.status);
    const txt = await res.text();
    console.log('body:', txt);
  } catch (e) {
    console.error('error', e);
  }
})();
