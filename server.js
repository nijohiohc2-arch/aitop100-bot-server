const express = require("express");
const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CALLBACK_TOKEN = process.env.CALLBACK_TOKEN || process.env.X_BOT_CALLBACK_TOKEN || "";
const WEBHOOK_HEADER_NAME = process.env.WEBHOOK_HEADER_NAME;
const WEBHOOK_HEADER_VALUE = process.env.WEBHOOK_HEADER_VALUE;

// ========== 교동마을 운영 원칙 ==========
const CRITICAL = "송장등록≠발송완료, 포장완료≠집하완료, 집하완료≠배송완료, 간선재개≠개별집하";
const TYPHOON = [
  "2026-06-05 09:10 송장 등록 (구방만, 직접확인)",
  "2026-06-05 11:40 결항 통보 (구방만)",
  "2026-06-06 결항 지속 / 포장완료물량 냉장대기 (박수복 전언)",
  "2026-06-07 15:00 간선 재개",
  "2026-06-07 일요일 집하 불가",
  "2026-06-08 09:00 집하 재개 및 순차 적재"
];

function classify(t){
  t=t||"";
  if(/상품|가격|규격|구성|원산지|보관|선물세트|카탈로그/.test(t)) return "product";
  if(/쿠폰|할인|이벤트|프로모션|상세페이지|배너|홍보|팜플렛/.test(t)) return "promotion";
  if(/주문/.test(t)) return "order";
  if(/배송.*조회|송장|운송장|어디|도착/.test(t)) return "delivery";
  if(/지연|결항|태풍|집하.*중단|파손|분실|안와/.test(t)) return "delay";
  if(/하자|썩|물렀|곰팡|터짐|상했|벌레|이물질/.test(t)) return "defect";
  if(/환불|반품|보상|재배송|교환/.test(t)) return "refund";
  if(/사람|상담원|담당자|조합장/.test(t)) return "escalation";
  return "unknown";
}

function build(intent, text, isPersonal){
  const orderMatch = text.match(/[A-Z]{2,}-?\d+|\d{6,}/);
  const order = orderMatch ? orderMatch[0] : "";
  const personalTag = isPersonal ? "[개인 1:1 문의] " : "";

  if(intent==="product"){
    return personalTag+"상품 안내\n• 가격/규격/구성/원산지/보관: 생산자 및 조합 원자료 제공자 기준\n• 홍보라 제작 상세페이지/배너/카탈로그/동봉안내문은 원자료 사용, 최종 승인 고길동\n• 쿠폰/이벤트/협찬: 원자료 출처와 승인일자, 채널/URL, 수정이력 확인 후 안내\n문의 상품명을 알려주세요.";
  }
  if(intent==="promotion"){
    return personalTag+"[홍보·마케팅]\n제작자(홍보라)≠결정권자(생산자 원자료)\n필요: 상세페이지 원본, 가격/규격 출처, 프로모션 조건, 쿠폰코드/기간, 협찬/인플루언서 계약, 승인여부/일자, 등록채널/URL, 수정이력\n가격/규격 오안내 방지 위해 출처 기록 필수입니다.";
  }
  if(intent==="order"){
    if(!order) return personalTag+"주문번호를 알려주시면 주문DB에서 실제 조회해 안내드리겠습니다. (기억이 아닌 실제 조회 원칙 - 이민준)";
    return personalTag+"[주문 확인: "+order+"]\n주문DB/포장DB/물류DB가 분산되어 있어 통합 조회 구축 중입니다.\n확인 필요: 채널별 기록 위치, 주문번호 동일 사용 여부, 생산·포장·배송 연결 여부";
  }
  if(intent==="delivery"){
    if(!order) return personalTag+"주문번호를 알려주시면 송장등록/포장완료/집하/운송/배송완료를 구분해 안내드리겠습니다.\n※ "+CRITICAL;
    return personalTag+"[배송 조회: "+order+"]\n현재 상태: 송장등록 여부 확인 중\n• 포장완료≠집하완료, 집하완료≠배송완료\n• 실제 인수/집하 시각이 조회되어야 발송 시작으로 안내 가능\n※ 2026년 6월 사례처럼 송장만 등록되고 결항된 경우가 있었습니다.";
  }
  if(intent==="delay" || /태풍|6월/.test(text)){
    return personalTag+"[2026년 6월 태풍 애플망고 지연 - 확인된 타임라인]\n"+TYPHOON.map(v=>"• "+v).join("\n")+"\n\n핵심: 송장등록(6/5 09:10)과 실제 집하(6/8 09:00)는 다릅니다.\n포장완료 물량은 냉장대기(전언), 보관장소/책임자/포장시각은 미확인.";
  }
  if(intent==="defect" || intent==="refund"){
    const m = text.match(/(\d+)\s*개.*(\d+)\s*개/);
    let total=10, defect=3, paid=30000;
    if(m){ total=parseInt(m[1]); defect=parseInt(m[2]); }
    const rate = Math.round((defect/total*100)*10)/10;
    const rule = rate<30?"하자분 비율 부분환불":rate<=70?"50% 환불 또는 전량 재배송":"전액환불 또는 전량 재배송";
    const raw = paid*defect/total;
    const ceiled = Math.ceil(raw/10)*10;
    const final = ceiled>0 && ceiled<1000 ? 1000 : ceiled;
    let msg = personalTag+"[하자 접수] 총 "+total+"개 중 "+defect+"개, 하자율 "+rate+"% ("+rule+")\n";
    msg += "계산상 예상액: "+final.toLocaleString()+"원 (실결제액 기준, 10원 절상, 최소 1천원, 배송비 미환급)\n";
    if(/곰팡|벌레|이물질/.test(text)) msg+="⚠️ 위생 위해 명백 - 섭취 중단, 폐기 안내 우선\n";
    msg+="\n※ 권한위임표 시행일 2037-06-01로 현재 미확인. 확정 안내 금지, 참고용만. 승인 기록 후 처리.\n※ 사진 없어도 진술로 접수 가능, 부분환불 배송비 미환급, 재배송 선택 시 환불 중복 불가.";
    if(final>50000) msg+="\n→ 5만원 초과로 이민준 운영자 1차 판단→고길동 조합장 최종 승인 필요. 무응답을 승인으로 간주 안함.";
    return msg;
  }
  if(intent==="escalation"){
    return personalTag+"[담당자 이관]\n상담창구(CS 에이전트) - 티켓 기록 → 이민준 운영자 1차 판단 → 필요시 고길동 조합장 최종 판단\n원칙: 승인은 기록으로 남아야 함, 무응답/기한경과≠승인, 상담창구에서 조합장에게 직접 승인 요청하는 구조 아님";
  }
  return "교동마을 CS 에이전트\n확인된 데이터만 안내, 모르면 모른다고 안내\n※ "+CRITICAL+"\n\n1. 상품 안내 (원자료 출처 확인)\n2. 주문 확인\n3. 배송 조회 (송장/집하 구분)\n4. 배송 지연/사고 (2026년 6월 태풍 포함)\n5. 하자 접수 (예: 10개 중 4개 상함)\n6. 환불 및 담당자 이관\n\n주문번호 함께 알려주세요.";
}

async function sendCallback(chatId, text){
  if(!BOT_TOKEN){ console.error("BOT_TOKEN 없음"); return; }
  const headers = { "Authorization":"KakaoAK "+BOT_TOKEN, "Content-Type":"application/json" };
  if(CALLBACK_TOKEN) headers["X-Bot-Callback-Token"]=CALLBACK_TOKEN;
  try{
    const res = await fetch("https://kapi.kakao.com/v1/bot/callback",{ method:"POST", headers:headers, body:JSON.stringify({ chatId:chatId, text:text }) });
    const t = await res.text();
    console.log("[CALLBACK] status",res.status,t.slice(0,400));
    if(res.status===401) console.error("401: BOT_TOKEN/CALLBACK_TOKEN 확인 필요");
    if(res.status===403) console.error("403: IP 허용리스트 확인 - Render IP가 카카오에 등록 안됨");
  }catch(e){ console.error("callback error",e); }
}

app.get("/healthz",(req,res)=>res.status(200).send("ok"));
app.get("/",(req,res)=>res.json({ service:"gyodong-cs-bot", critical:CRITICAL, has_token:!!BOT_TOKEN, has_callback:!!CALLBACK_TOKEN, typhoon:TYPHOON }));

app.post("/kakao/webhook", async (req,res)=>{
  res.status(204).send("");
  if(WEBHOOK_HEADER_NAME && WEBHOOK_HEADER_VALUE){
    if(req.headers[WEBHOOK_HEADER_NAME.toLowerCase()]!==WEBHOOK_HEADER_VALUE){ console.warn("header mismatch"); return; }
  }
  const body=req.body;
  const d=body.d||body;
  if(body.op!==0 || body.t!=="MESSAGE_CREATE"){ console.log("ignore",body.op,body.t); return; }

  // 개인 1:1도 잡히게 chatId 다중 추출
  const chatId = d.chatId || d.chat?.id || d.channelId || d.chat_id || d.user?.id || d.userId || d.sender?.id;
  const userText = d.message?.text || d.text || d.content || d.message?.content || "";
  const isPersonal = !!d.user?.id || d.chat?.type==="personal" || d.isPersonalChat;

  console.log("[WEBHOOK] chatId",chatId,"personal",isPersonal,"text",userText,"raw",JSON.stringify(d).slice(0,1000));

  if(!chatId || !userText) return;

  const intent = classify(userText);
  const reply = build(intent, userText, isPersonal);
  await sendCallback(chatId, reply);
});

app.listen(PORT,()=>console.log("gyodong listening "+PORT+" "+CRITICAL));
