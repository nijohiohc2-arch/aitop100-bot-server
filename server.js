const express = require('express');
const app = express();
app.use(express.json({ limit: '1mb' }));
const SECRET = process.env.WEBHOOK_SHARED_SECRET;
app.get('/healthz', (req, res) => res.status(200).send('ok'));
app.get('/', (req, res) => res.status(200).send('aitop100-bot ok'));
app.post('/kakao/webhook', (req, res) => {
  if (SECRET && req.get('authorization') !== SECRET && req.get('authorization') !== `Bearer ${SECRET}`) {
    return res.status(401).json({ ok: false });
  }
  const body = req.body || {};
  try { console.log('[webhook]', JSON.stringify(body)); } catch (e) {}
  const utt = body && body.userRequest && body.userRequest.utterance;
  if (typeof utt === 'string') {
    return res.status(200).json({ version: '2.0', template: { outputs: [{ simpleText: { text: `받은 메시지: ${utt}` } }] } });
  }
  res.status(200).json({ ok: true });
});
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('listening on', port));
