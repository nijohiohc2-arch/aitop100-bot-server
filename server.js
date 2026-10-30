const express = require('express');
const app = express();
app.use(express.json({ limit: '1mb' }));
const BOT_TOKEN = process.env.BOT_TOKEN;
const HN = process.env.WEBHOOK_HEADER_NAME, HV = process.env.WEBHOOK_HEADER_VALUE;

app.get('/healthz', (req, res) => res.status(200).send('ok'));
app.get('/', (req, res) => res.status(200).send('aitop100-bot ok'));

async function reply(d) {
  if (!BOT_TOKEN) return console.warn('[callback] BOT_TOKEN unset; skip');
  const content = String(d.content || '').slice(0, 200);
  const text = `마을봇 준비됨. 내일 예선에서 에이전트 로직을 연결하세요.\n받은 메시지: ${content}`;
  try {
    const r = await fetch('https://kapi.kakao.com/v1/bot/callback', {
      method: 'POST',
      headers: { Authorization: `KakaoAK ${BOT_TOKEN}`, 'X-Bot-Callback-Token': d.callbackToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillResponse: { version: '2.0', template: { outputs: [{ simpleText: { text } }] } } }),
    });
    console.log('[callback]', r.status, await r.text());
  } catch (e) { console.error('[callback] error', e.message); }
}

app.post('/kakao/webhook', (req, res) => {
  if (HN && HV && req.get(HN) !== HV) return res.status(401).end();
  const b = req.body || {};
  console.log('[webhook]', JSON.stringify({ ...b, d: b.d ? { ...b.d, callbackToken: b.d.callbackToken ? '***' : undefined } : undefined }));
  res.status(204).end();
  if (b.op === 0 && b.t === 'MESSAGE_CREATE' && b.d && b.d.callbackToken) setImmediate(() => reply(b.d));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('listening on', port));
