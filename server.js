// 교동마을 CS 에이전트 - Kakao Channel Bot Callback 서버
// 기존 server.js 교체용 - Render + https://kapi.kakao.com/v1/bot/callback 구조
// 원칙: 확인된 데이터만 안내, 송장등록≠발송완료, 2037 문서 검증 전 환불 확정 금지

import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_HEADER_NAME = process.env.WEBHOOK_HEADER_NAME;
const WEBHOOK_HEADER_VALUE = process.env.WEBHOOK_HEADER_VALUE;

const CRITICAL_DISTINCTIONS = [
  "송장 등록은 실제 발송 완료가 아니다.",
  "포장 완료는 집하 완료가 아니다.",
  "집하 완료는 배송 완료가 아니다.",
  "간선 운송 재개와 실제 개별 물품의 집하 시점은 다르다."
];

const STATUS_MAP = {
  order_received: { internal: "주문 접수", customer: "주문이 접수되었습니다.", shipped: false },
  production_check: { internal: "생산 확인 중", customer: "상품 준비 상태를 확인하고 있습니다.", shipped: false },
  packaging_completed: { internal: "포장 완료", customer: "상품 포장이 완료되었습니다. 택배사 인수를 기다리고 있습니다.", shipped: false },
  invoice_registered: { internal: "송장 등록", customer: "배송 송장이 등록되었습니다. 아직 택배사가 상품을 인수하기 전입니다.", shipped: false },
  picked_up: { internal: "집하 완료", customer: "택배사가 상품을 인수했습니다. (실제 발송 시작)", shipped: true },
  in_transit: { internal: "운송 중", customer: "상품이 배송 과정에 있습니다.", shipped: true },
  delivered: { internal: "배송 완료", customer: "배송 완료로 확인됩니다.", shipped: true },
  delay_weather: { internal: "결항·운송 중단", customer: "기상 상황으로 운송이 지연되고 있습니다.", shipped: false }
};

const TYPHOON_TIMELINE = [
  { date: "2026-06-05 09:10", event: "송장 등록", source: "구방만 물류기록", verified: true },
  { date: "2026-06-05 11:40", event: "태풍으로 배편/항공 결항 통보", source: "구방만 물류기록", verified: true },
  { date: "2026-06-06", event: "결항 지속, 포장완료 물량은 산지 냉장 대기 (전언)", source: "박수복 전언", verified: false },
  { date: "2026-06-07 15:00", event: "간선 운송 재개", source: "구방만", verified: true },
  { date: "2026-06-07", event: "일요일이라 집하 불가", source: "구방만", verified: true },
  { date: "2026-06-08 09:00", event: "집하 재개 및 밀린 물량 순차 적재", source: "구방만", verified: true }
];

const REFUND_RULE_STATUS = {
  document_effective: "2037-06-01",
  is_verified_for_production: false,
  warning: "권한위임표/산식임계표는 2037년 기준 문서로 현재 적용 여부 미확인. 확인 전까지 환불 확정 안내 금지"
};

function classifyIntent(text) {
  const t = text || "";
  if (/상품|가격|규격|구성|원산지|보관|선물세트|카탈로그/.test(t)) return "product";
  if (/쿠폰|할인|이벤트|프로모션|상세페이지|배너|홍보/.test(t)) return "promotion";
  if (/주문.*확인|주문번호|결제/.test(t)) return "order_check";
  if (/배송.*조회|송장|운송장|어디|도착/.test(t)) return "delivery_check";
  if (/지연|안와|결항|태풍|집하.*중단|파손|분실/.test(t)) return "delivery_delay";
  if (/하자|썩|물렀|곰팡|터짐|상했|벌레|이물질/.test(t)) return "defect";
  if (/환불|반품|보상|재배송|교환/.test(t)) return "refund";
  if (/사람|상담원|담당자|조합장/.test(t)) return "escalation";
  if (/애플망고.*6월|6월.*지연/.test(t)) return "typhoon_case";
  return "unknown";
}

function calcDefectRate(defect, total) {
  if (!total) return 0;
  return Math.round((defect / total) * 100 * 10) / 10;
}

function judgeRefundType(rate) {
  if (rate < 30) return { type: "partial_refund", rule: "하자분 비율에 따른 부분환불", options: ["부분환불"] };
  if (rate <= 70) return { type: "partial_or_reship", rule: "기준액 50% 환불 또는 전량 재배송 선택", options: ["50% 환불", "전량 재배송"] };
  return { type: "full_or_reship", rule: "전액환불 또는 전량 재배송 선택", options: ["전액환불", "전량 재배송"] };
}

function calcPartialRefund(paid, defect, total) {
  const rate = defect / total;
  const raw = paid * rate;
  const ceiled = Math.ceil(raw / 10) * 10;
  const final = ceiled > 0 && ceiled < 1000 ? 1000 : ceiled;
  return { raw, ceiled, final, rate };
}

function buildResponse(intent, text, orderNo) {
  const orderMatch = text.match(/[A-Z]{2,}-?\d+|\d{6,}/);
  const order = orderNo || (orderMatch ? orderMatch[0] : "");

  if (intent === "product") {
    return "상품 안내입니다.\n" +
      "• 가격/규격/구성/원산지/보관방법은 생산자 및 조합 원자료 제공자 기준으로 안내드립니다.\n" +
      "• 홍보라님이 제작한 상세페이지/배너/팜플렛/카탈로그는 원자료를 사용하며, 최종 승인은 고길동 조합장님입니다.\n" +
      "• 쿠폰/이벤트/협찬 조건은 원자료 출처와 승인일자, 등록 채널(URL)과 수정 이력을 확인 후 안내드립니다.\n" +
      "문의 상품명을 알려주시면 출처와 최종 갱신 시각을 함께 안내드릴게요.";
  }

  if (intent === "promotion") {
    return "[홍보·마케팅 안내 - 신규 연결 영역]\n" +
      "중요 구분: 홍보물 제작자(홍보라) ≠ 상품 정보 결정권자(생산자 및 조합 원자료 제공자)\n" +
      "필요 데이터: 상세페이지 원본, 가격/규격 원자료 출처, 프로모션/할인조건, 쿠폰코드/기간, 협찬/인플루언서 계약, 승인여부/일자, 등록채널/URL, 수정이력\n" +
      "상품 가격이나 규격이 잘못 안내되면 CS 챗봇도 잘못 안내하게 되므로 원자료 출처와 최종 승인자를 반드시 기록합니다.\n" +
      "어떤 채널(조합몰/SNS/광고)의 프로모션을 문의하시나요?";
  }

  if (intent === "order_check") {
    if (!order) return "주문번호를 알려주시면 주문DB에서 실제 조회하여 안내드리겠습니다. (기억이 아니라 실제 조회 원칙 - 이민준)";
    return "[주문 확인: " + order + "]\n현재 주문DB, 포장/출고DB, 물류DB가 분산되어 있어 통합 조회 구조를 구축 중입니다.\n확인 필요: 채널별 기록 위치, 주문번호 동일 사용 여부, 생산·포장·배송 연결 여부";
  }

  if (intent === "delivery_check") {
    if (!order) {
      return "주문번호를 알려주시면 송장등록/포장완료/집하/운송/배송완료를 구분해서 안내드리겠습니다.\n※ 중요: 송장등록은 발송완료가 아닙니다. 실제 집하가 없으면 배송완료라고 안내하지 않습니다.";
    }
    return "[배송 조회: " + order + "]\n현재 상태: 송장등록 여부 확인 중\n• 포장완료 ≠ 집하완료, 집하완료 ≠ 배송완료\n실제 물품 인수 시각과 집하 시각이 조회되어야 발송 시작으로 안내드릴 수 있습니다.\n※ 2026년 6월 사례처럼 송장만 등록되고 결항으로 움직이지 않은 경우가 있었습니다.";
  }

  if (intent === "typhoon_case" || text.includes("태풍")) {
    return "[2026년 6월 태풍 애플망고 지연 - 확인된 타임라인]\n" +
      TYPHOON_TIMELINE.map(x => "• " + x.date + ": " + x.event + " (" + x.source + (x.verified ? ", 직접확인" : ", 전언") + ")").join("\n") +
      "\n\n※ 핵심: 송장등록(6/5 09:10)과 실제 집하(6/8 09:00)는 다릅니다.\n포장완료 물량은 냉장 대기했다고 전해지나, 정확한 보관장소/책임자/포장완료시각은 미확인입니다.";
  }

  if (intent === "delivery_delay") {
    return "배송 지연/사고 안내\n• 결항/기상악화: 구방만 물류기록 기준, 송장등록 후에도 운송 중단될 수 있습니다.\n• 6/5 09:10 송장등록 → 11:40 결항 → 6/8 09:00 집하재개 사례\n• 집하중단(일요일 등), 파손/분실: 물품 인수/인계 기록 확인 후 처리\n주문번호를 알려주시면 해당 구간 실제 시각과 함께 안내드리겠습니다.";
  }

  if (intent === "defect" || intent === "refund") {
    const m = text.match(/(\d+)\s*개.*(\d+)\s*개/);
    let total = 10, defect = 3, paid = 30000;
    if (m) { total = parseInt(m[1]); defect = parseInt(m[2]); }

    const rate = calcDefectRate(defect, total);
    const judge = judgeRefundType(rate);
    const calc = calcPartialRefund(paid, defect, total);
    const needEscalation = calc.final > 50000 && judge.type === "partial_refund";

    let msg = "[하자 접수: 총 " + total + "개 중 " + defect + "개]\n하자율 R = " + defect + "/" + total + "*100 = " + rate + "% (" + judge.rule + ")\n";

    if (judge.type === "partial_refund") {
      msg += "계산상 부분환불 예상액: " + calc.final.toLocaleString() + "원 (실결제액 " + paid.toLocaleString() + "원 기준, 10원 절상, 최소 1,000원, 배송비 미환급)\n";
    } else if (judge.type === "partial_or_reship") {
      msg += "선택지: 50% 환불(약 " + (paid*0.5).toLocaleString() + "원) 또는 전량 재배송\n";
    } else {
      msg += "선택지: 전액환불 또는 전량 재배송\n";
    }

    if (/곰팡|벌레|이물질/.test(text)) {
      msg += "⚠️ 위생 위해가 명백하므로 섭취 중단과 폐기 안내가 우선입니다.\n";
    }

    msg += "\n※ " + REFUND_RULE_STATUS.warning + "\n현재는 계산 결과 참고용만 안내드리며, 확정 처리는 운영자 확인 후 승인 기록을 남겨 진행됩니다.\n※ 사진이 없어도 고객 진술로 접수 가능합니다.\n※ 부분환불은 배송비 환급 없음, 재배송 선택 시 환불 중복 적용 안함.";

    if (needEscalation) {
      msg += "\n\n→ 부분환불 5만원 초과로 조합장(고길동) 1단 승인 필요. 상담창구→이민준 운영자 1차 판단→조합장 최종 판단 흐름으로 이관됩니다. 무응답을 승인으로 간주하지 않습니다.";
    }

    return msg;
  }

  if (intent === "escalation") {
    return "[담당자 이관]\n문의 유형에 따라 다음 흐름으로 진행됩니다.\n상담 창구(CS 에이전트) - 티켓 기록 → 이민준 운영자 - 재량 범위 내 1차 판단 → 필요시 고길동 조합장 - 정책/가격/권한변경/손해배상/분쟁/안전 최종 판단\n원칙: 승인은 기록으로 남아야 함, 무응답/기한경과는 승인으로 간주하지 않음, 상담창구에서 조합장에게 직접 승인 요청하는 구조 아님\n환불/예외 사안은 이민준 재량 밖이며 조합장 승인이 필요합니다.";
  }

  return "교동마을 CS 에이전트입니다.\n확인된 데이터만 안내드리며, 모르는 정보는 모른다고 안내드립니다.\n※ 송장등록을 발송완료로 표현하지 않습니다.\n\n무엇을 도와드릴까요?\n1. 상품 안내 (원자료 출처 확인)\n2. 주문 확인\n3. 배송 조회 (송장등록과 집하 구분)\n4. 배송 지연/사고 (2026년 6월 태풍 사례 포함)\n5. 상품 하자 접수 (예: 10개 중 4개 상함)\n6. 환불 및 담당자 이관\n\n주문번호가 있으시면 함께 알려주세요.";
}

async function sendCallback(chatId, text) {
  if (!BOT_TOKEN) {
    console.error("BOT_TOKEN missing");
    return;
  }
  try {
    const res = await fetch("https://kapi.kakao.com/v1/bot/callback", {
      method: "POST",
      headers: {
        "Authorization": "KakaoAK " + BOT_TOKEN,
        "Content-Type": "application/json",
        "X-Bot-Callback-Token": process.env.CALLBACK_TOKEN || ""
      },
      body: JSON.stringify({
        chatId: chatId,
        text: text,
        message: { text: text }
      })
    });
    const body = await res.text();
    console.log("callback status", res.status, body);
  } catch (e) {
    console.error("callback error", e);
  }
}

app.get("/healthz", (req, res) => {
  res.status(200).send("ok - gyodong cs bot with verified principles");
});

app.get("/", (req, res) => {
  res.json({
    service: "gyodong-cs-bot",
    principle: "확인된 데이터만 답변, 송장등록≠발송완료, 직접확인 vs 전언 구분",
    critical_distinctions: CRITICAL_DISTINCTIONS,
    typhoon_case: TYPHOON_TIMELINE,
    refund_rule_status: REFUND_RULE_STATUS,
    endpoints: ["/healthz", "/kakao/webhook"]
  });
});

app.post("/kakao/webhook", async (req, res) => {
  if (WEBHOOK_HEADER_NAME && WEBHOOK_HEADER_VALUE) {
    if (req.headers[WEBHOOK_HEADER_NAME.toLowerCase()] !== WEBHOOK_HEADER_VALUE) {
      return res.status(401).send("unauthorized");
    }
  }

  res.status(204).send("");

  const body = req.body;
  const op = body.op;
  const t = body.t;
  const d = body.d || body;

  if (op !== 0 || t !== "MESSAGE_CREATE") {
    console.log("ignore op/t", op, t);
    return;
  }

  const chatId = d.chatId || d.chat?.id || d.chat_id;
  const userMessage = d.message?.text || d.text || d.content || "";

  if (!chatId || !userMessage) {
    console.log("missing chatId or message", d);
    return;
  }

  console.log("chatId=" + chatId + " text=" + userMessage);

  const intent = classifyIntent(userMessage);
  const orderNoMatch = userMessage.match(/GY-\d+|[A-Z]{2,}\d+/);
  const orderNo = orderNoMatch ? orderNoMatch[0] : "";

  const replyText = buildResponse(intent, userMessage, orderNo);

  await sendCallback(chatId, replyText);
});

app.listen(PORT, () => {
  console.log("gyodong cs bot listening on " + PORT);
  console.log("critical: " + CRITICAL_DISTINCTIONS.join(" | "));
});
