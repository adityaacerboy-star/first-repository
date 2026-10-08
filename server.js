require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Simple per-IP rate limit so one visitor cannot drain your API credits.
const hits = new Map();
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 60) return res.status(429).json({ error: 'Too many requests' });
  recent.push(now);
  hits.set(req.ip, recent);
  next();
});

async function callAI(prompt, wantJson) {
  const provider = (process.env.PROVIDER || 'gemini').toLowerCase();
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
        max_tokens: wantJson ? 1800 : 200,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!r.ok) throw new Error('Anthropic ' + r.status);
    const d = await r.json();
    return d.content.map(c => c.text || '').join('');
  }
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  if (wantJson) body.generationConfig = { responseMimeType: 'application/json' };
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('Gemini ' + r.status);
  const d = await r.json();
  return (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

app.post('/api/ai', async (req, res) => {
  const { prompt, json } = req.body || {};
  if (typeof prompt !== 'string' || !prompt || prompt.length > 12000)
    return res.status(400).json({ error: 'Bad prompt' });
  try {
    res.json({ text: await callAI(prompt, !!json) });
  } catch (e) {
    console.error('AI call failed:', e.message); // never log keys
    res.status(502).json({ error: 'AI call failed' });
  }
});

app.get('/api/health', (req, res) =>
  res.json({ ok: true, ai: !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY) }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('GD Arena running on http://localhost:' + port));
