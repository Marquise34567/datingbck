(async () => {
  const ports = [4000, 3001, 3000];
  for (const p of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: "He hasn't replied in 3 days, what should I text?", mode: 'dating' }),
      });
      console.log('port', p, 'status', res.status);
      const txt = await res.text();
      console.log('port', p, 'body:', txt);
    } catch (e) {
      console.error('port', p, 'error', e.message || e);
    }
  }
})();
