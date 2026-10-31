# aitop100-bot-server
교동마을 CS. 카카오 웹훅은 그대로 두고 답변만 바꿉니다.

- GET /healthz -> `ok - gyodong cjs`
- GET / -> 토큰 존재 여부만 (값은 안 보여 줌)
- POST /kakao/webhook -> 즉시 204. `op=0` & `t=MESSAGE_CREATE` 이면 콜백
- 콜백 본문: chatId가 있으면 `{ chatId, text }`, 없으면 스킬 JSON
- 헤더: `Authorization: KakaoAK BOT_TOKEN`, 토큰이 있으면 `X-Bot-Callback-Token`
- Env: PORT, BOT_TOKEN, CALLBACK_TOKEN(또는 X_BOT_CALLBACK_TOKEN), WEBHOOK_HEADER_NAME, WEBHOOK_HEADER_VALUE
- REFUND_POLICY_ACTIVE=1 로 두기 전에는 환불액을 검토용으로만 보여주고 실행하지 않음

송장 등록은 발송 완료가 아니다. 집하 시각이 없으면 인수로 말하지 않는다. 없는 주문·생산자·포장 담당·프로모션은 만들지 않는다. 이관은 이민준까지이고 조합장에게 직접 승인 요청을 보내지 않는다.

카카오에서:
- 메뉴
- 배송 조회 GD-20260605-0142
- GD-20261020-0088
- GD-20261028-0031
- GD-20261030-0102
- 하자 접수 후 주문번호, `2/10`, `아니오`, `접수`
- 상담원 연결
