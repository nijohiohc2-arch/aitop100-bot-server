# aitop100-bot-server
Minimal Kakao chatbot webhook stub for AI_TOP_100 2026.
- GET /healthz -> ok
- POST /kakao/webhook -> SkillResponse 2.0 echo if userRequest.utterance, else {"ok":true}
- Env: PORT, optional WEBHOOK_SHARED_SECRET (checks Authorization header)
