# aitop100-bot-server
Kakao bot webhook stub (AI_TOP_100 2026).
- GET /healthz -> 200 ok
- POST /kakao/webhook -> 204 immediately; for op=0 & t=MESSAGE_CREATE, async POST to https://kapi.kakao.com/v1/bot/callback (KakaoAK BOT_TOKEN + X-Bot-Callback-Token)
- Env: PORT, BOT_TOKEN, optional WEBHOOK_HEADER_NAME/WEBHOOK_HEADER_VALUE
- Note: server egress IP must be in Kakao admin key IP allowlist.
