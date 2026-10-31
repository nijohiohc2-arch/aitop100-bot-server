// 교동마을 CS - CommonJS 버전 (package.json type 없어도 동작)
// Node 18+는 fetch 내장이라 node-fetch 불필요

const express = require("express");
const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CALLBACK_TOKEN = process.env.CALLBACK_TOKEN || process.env.X_BOT_CALLBACK_TOKEN || "";
const WEBHOOK_HEADER_NAME = process.env.WEBHOOK_HEADER_NAME;
const WEBHOOK_HEADER_VALUE = process.env.WEBHOOK_HEADER_VALUE;

console.log("[BOOT] PORT", PORT, "BOT_TOKEN exists?", !!BOT_TOKEN, "CALLBACK_TOKEN exists?", !!CALLBACK_TOKEN);

const TYPHOON = [
  "2026-06-05 09:10 송장 등록 (구방만, 직접확인)",
  "2026-06-05 11:40 결항 통보 (구방만)",
  "2026-06-06 결항 지속 (박수복 전언, 직접확인 아님)",
  "2026-06-07 15:00 간선 재개",
  "2026-06-07 일요일 집하 불가",
  "2026-06-08 09:00 집하 재개"
];

function classify(text){
  const t = text||"";
  if(/상품|가격|규격|구성|원산지/.test(t)) return "product";
  if(/쿠폰|할인|이벤트|프로모션|홍보/.test(t)) return "promotion";
  if(/주문/.test(t)) return "order_check";
  if(/배송.*조회|송장|운송장/.test(t)) return "delivery_check";
  if(/지연|결항|태풍|집하/.test(t)) return "delivery_delay";
  if(/하자|썩|곰팡|터짐|상했/.test(t)) return "defect";
  if(/환불|반품|재배송/.test(t)) return "refund";
  if(/사람|상담원|담당자/.test(t)) return "escalation";
  if(/태풍|6월/.test(t)) return "typhoon";
  return "unknown";
}

function build(intent, text){
  if(intent==="product"){
    return "상품 안내\n• 가격/규격/구성은 생산자 원자료 제공자 기준\n• 홍보라 제작 상세페이지/배너/카탈로그는 원자료 사용, 최종 승인 고길동\n• 쿠폰/이벤트는 원자료 출처와 승인일자 확인 후 안내\n문의 상품명을 알려주세요.";
  }
  if(intent==="promotion"){
    return "[홍보] 제작자(홍보라)≠결정권자(생산자 원자료)\n필요: 상세페이지 원본, 가격/규격 출처, 프로모션 조건, 쿠폰/기간, 협찬 계약, 승인여부/일자, 채널/URL, 수정이력";
  }
  if(intent==="order_check"){
    return "주문번호를 알려주시면 주문DB에서 실제 조회해 안내드리겠습니다. (기억이 아니라 실제 조회 원칙)";
  }
  if(intent==="delivery_check"){
    return "배송 조회\n• 송장등록≠발송완료, 포장완료≠집하완료, 집하완료≠배송완료\n주문번호 주시면 집하시각 기준으로 구분 안내드릴게요.\n※ 2026년 6월 사례처럼 송장만 등록되고 결항된 경우가 있었습니다.";
  }
  if(intent==="typhoon" || text.includes("태풍")){
    return "[2026년 6월 태풍 지연]\n" + TYPHOON.map(v=>"• "+v).join("\n") + "\n\n핵심: 송장등록(6/5 09:10)과 실제 집하(6/8 09:00)는 다릅니다.";
  }
  if(intent==="delivery_delay"){
    return "배송 지연 안내\n• 결항 시 송장등록 후에도 운송 중단 가능 (구방만 기록)\n• 6/5 09:10 등록→11:40 결항→6/8 09:00 집하재개 사례\n주문번호 주시면 실제 시각 조회해 안내드릴게요.";
  }
  if(intent==="defect" || intent==="refund"){
    const m = text.match(/(\d+)\s*개.*(\d+)\s*개/);
    let total=10, defect=3, paid=30000;
    if(m){ total=parseInt(m[1]); defect=parseInt(m[2]); }
    const rate = Math.round((defect/total*100)*10)/10;
    let rule = rate<30?"부분환불":rate<=70?"50% 환불 또는 전량 재배송":"전액환불 또는 전량 재배송";
    let msg = "[하자 접수] 총 "+total+"개 중 "+defect+"개, 하자율 "+rate+"% ("+rule+")\n";
    const raw = paid*defect/total;
    const ceiled = Math.ceil(raw/10)*10;
    const final = ceiled>0 && ceiled<1000?1000:ceiled;
    msg += "계산상 예상액: "+final.toLocaleString()+"원 (실결제액 기준, 10원 절상, 최소 1천원, 배송비 미환급)\n";
    msg += "\n※ 권한위임표 시행일 2037-06-01로 현재 미확인. 확정 안내 금지, 참고용만. 승인 기록 후 처리.\n※ 사진 없어도 진술로 접수 가능, 위생 위해시 섭취중단 우선.";
    if(final>50000) msg+="\n→ 5만원 초과로 이민준→고길동 승인 필요. 무응답을 승인으로 간주 안함.";
    return msg;
  }
  if(intent==="escalation"){
    return "[담당자 이관]\n상담창구→이민준 운영자 1차 판단→필요시 고길동 최종 판단\n원칙: 승인은 기록, 무응답≠승인, 상담창구가 조합장에게 직접 요청하는 구조 아님";
  }
  return "교동마을 CS 에이전트\n확인된 데이터만 안내, 모르면 모른다고 안내\n※ 송장등록을 발송완료로 표현 안함\n\n1. 상품 안내\n2. 주문 확인\n3. 배송 조회 (송장/집하 구분)\n4. 배송 지연 (태풍 사례)\n5. 하자 접수 (예: 10개 중 4개 상함)\n6. 담당자 이관\n\n주문번호 함께 알려주세요.";
}

async function sendCallback(chatId, text){
  if(!BOT_TOKEN){
    console.error("[CALLBACK] BOT_TOKEN 없음");
    return;
  }
  const url = "https://kapi.kakao.com/v1/bot/callback";
  const headers = {
    "Authorization": "KakaoAK " + BOT_TOKEN,
    "Content-Type": "application/json"
  };
  if(CALLBACK_TOKEN) headers["X-Bot-Callback-Token"] = CALLBACK_TOKEN;
  
  const body = JSON.stringify({ chatId: chatId, text: text });
  console.log("[CALLBACK] POST", url, "chatId", chatId, "len", text.length);
  try{
    const res = await fetch(url, { method:"POST", headers: headers, body: body });
    const txt = await res.text();
    console.log("[CALLBACK] status", res.status, txt.slice(0,500));
    if(res.status===401) console.error("[CALLBACK] 401 - BOT_TOKEN 또는 CALLBACK_TOKEN 확인 필요, 또는 Render IP가 카카오 IP 허용리스트에 없음");
    if(res.status===403) console.error("[CALLBACK] 403 - IP 허용리스트 확인. Render는 outbound IP가 유동적이라 고정 IP 애드온 필요할 수 있음");
  }catch(e){
    console.error("[CALLBACK] fetch error", e);
  }
}

app.get("/healthz", (req,res)=>res.status(200).send("ok - gyodong cjs"));
app.get("/", (req,res)=>{
  res.json({
    service:"gyodong",
    bot_token: !!BOT_TOKEN,
    callback_token: !!CALLBACK_TOKEN,
    critical: "송장등록≠발송완료, 포장완료≠집하완료, 집하완료≠배송완료"
  });
});

// 디버그용 - 환경변수 확인 (토큰 값은 노출 안함)
app.get("/debug/env", (req,res)=>{
  res.json({
    has_bot_token: !!BOT_TOKEN,
    has_callback_token: !!CALLBACK_TOKEN,
    has_webhook_header: !!(WEBHOOK_HEADER_NAME && WEBHOOK_HEADER_VALUE),
    port: PORT,
    node_version: process.version
  });
});

app.post("/kakao/webhook", async (req,res)=>{
  // 1. 즉시 204 - 카카오는 3초 이내 응답 기대
  res.status(204).send("");

  // 헤더 검증 (설정했을 때만)
  if(WEBHOOK_HEADER_NAME && WEBHOOK_HEADER_VALUE){
    const hv = req.headers[WEBHOOK_HEADER_NAME.toLowerCase()];
    if(hv !== WEBHOOK_HEADER_VALUE){
      console.warn("[WEBHOOK] header mismatch", WEBHOOK_HEADER_NAME, hv);
      return;
    }
  }

  const body = req.body;
  console.log("[WEBHOOK] incoming", JSON.stringify(body).slice(0,2000));

  const op = body.op;
  const t = body.t;
  const d = body.d || body;

  if(op!==0 || t!=="MESSAGE_CREATE"){
    console.log("[WEBHOOK] ignore not MESSAGE_CREATE", op, t);
    return;
  }

  const chatId = d.chatId || d.chat?.id || d.chat_id || d.channelId;
  const userMessage = d.message?.text || d.text || d.content || d.message?.content || "";

  if(!chatId){
    console.error("[WEBHOOK] chatId missing", d);
    return;
  }
  if(!userMessage){
    console.log("[WEBHOOK] empty message, ignore");
    return;
  }

  const intent = classify(userMessage);
  console.log("[INTENT]", intent, "text", userMessage);

  const reply = build(intent, userMessage);
  await sendCallback(chatId, reply);
});

app.listen(PORT, ()=>console.log("listening "+PORT));
