const POLICY_ON = process.env.REFUND_POLICY_ACTIVE === '1';
const AGENT_PARTIAL_LIMIT = 50000;

const PRODUCTS = {
  'AM-GIFT-3': {
    name: '애플망고 선물세트',
    price: 45000,
    spec: '3kg',
    origin: '제주 교동마을',
    storage: '냉장',
    composition: '애플망고',
    source: '생산자·조합 원자료',
  },
  'WM-8': {
    name: '수박',
    price: 28000,
    spec: '8kg 내외',
    origin: '교동마을',
    storage: '서늘한 곳',
    composition: '수박 1통',
    source: '생산자·조합 원자료',
  },
  'ML-5': {
    name: '멜론',
    price: 32000,
    spec: '5kg 내외 2수',
    origin: '교동마을',
    storage: '냉장',
    composition: '멜론 2수',
    source: '생산자·조합 원자료',
  },
};

const ORDERS = {
  'GD-20260605-0142': {
    orderNo: 'GD-20260605-0142',
    sku: 'AM-GIFT-3',
    qty: 1,
    paid: 45000,
    payStatus: '결제완료',
    orderedAt: '2026-06-04 21:10',
    channel: '조합몰',
    status: 'suspended',
    invoiceAt: '2026-06-05 09:10',
    pickupAt: null,
    handoverAt: null,
    deliveredAt: null,
    timeline: [
      '2026-06-05 09:10 송장 등록',
      '2026-06-05 11:40 결항 통보',
      '2026-06-06 결항 지속',
      '2026-06-07 15:00 간선 운송 재개',
      '2026-06-07 일요일 집하 불가',
      '2026-06-08 09:00 집하 재개',
    ],
    source: '시원배송 결항·집하 기록',
    updatedAt: '2026-06-08 09:00',
    unverified: ['포장 완료 시각', '생산자', '냉장 보관 책임자', '품질'],
  },
  'GD-20261020-0088': {
    orderNo: 'GD-20261020-0088',
    sku: 'WM-8',
    qty: 1,
    paid: 28000,
    payStatus: '결제완료',
    orderedAt: '2026-10-20 11:02',
    channel: '조합몰',
    status: 'in_transit',
    invoiceAt: '2026-10-21 07:50',
    pickupAt: '2026-10-21 08:40',
    handoverAt: '2026-10-21 11:00',
    deliveredAt: null,
    timeline: [
      '2026-10-21 07:50 송장 등록',
      '2026-10-21 08:40 집하',
      '2026-10-21 11:00 운송 인계',
    ],
    source: '물류 인수 기록',
    updatedAt: '2026-10-21 11:00',
    unverified: ['배송 완료 시각'],
  },
  'GD-20261028-0031': {
    orderNo: 'GD-20261028-0031',
    sku: 'ML-5',
    qty: 1,
    paid: 32000,
    payStatus: '결제완료',
    orderedAt: '2026-10-28 09:12',
    channel: '조합몰',
    status: 'delivered',
    invoiceAt: '2026-10-28 15:10',
    pickupAt: '2026-10-28 16:40',
    handoverAt: '2026-10-28 18:00',
    deliveredAt: '2026-10-29 16:20',
    timeline: [
      '2026-10-28 15:10 송장 등록',
      '2026-10-28 16:40 집하',
      '2026-10-29 16:20 배송 완료',
    ],
    source: '배송 완료 기록',
    updatedAt: '2026-10-29 16:20',
    unverified: [],
  },
  'GD-20261030-0102': {
    orderNo: 'GD-20261030-0102',
    sku: 'AM-GIFT-3',
    qty: 1,
    paid: 45000,
    payStatus: '결제완료',
    orderedAt: '2026-10-30 19:40',
    channel: '조합몰',
    status: 'packed',
    invoiceAt: null,
    pickupAt: null,
    handoverAt: null,
    deliveredAt: null,
    timeline: ['2026-10-31 08:20 포장 완료'],
    source: '포장 기록',
    updatedAt: '2026-10-31 08:20',
    unverified: ['송장 번호', '집하 시각'],
  },
};

const sessions = new Map();
const tickets = [];
let seq = 0;

function clip(value, max) {
  const s = String(value || '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function won(n) {
  return `${Number(n).toLocaleString('ko-KR')}원`;
}

function norm(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

function productOf(order) {
  return PRODUCTS[order.sku] || { name: '확인되지 않은 상품', price: null };
}

function findOrderNo(text) {
  const m = String(text || '').toUpperCase().match(/GD-\d{8}-\d{4}/);
  return m ? m[0] : null;
}

function ratioOf(defect, total) {
  if (!Number.isInteger(defect) || !Number.isInteger(total) || total <= 0 || defect < 0 || defect > total) {
    return null;
  }
  return Math.round((defect / total) * 1000) / 10;
}

function ceil10(n) {
  return Math.ceil(n / 10 - 1e-9) * 10;
}

function payout(raw, paid) {
  let n = ceil10(raw);
  if (n < 1000) n = 1000;
  if (n > paid) n = paid;
  return n;
}

function quoteRefund(order, defect, total) {
  const ratio = ratioOf(defect, total);
  if (ratio == null) return { error: '개수 확인이 필요합니다.' };
  if (defect === 0) return { error: '하자 개수가 0이면 환불 검토를 하지 않습니다.' };
  const paid = order.paid;
  let band = 'partial';
  if (ratio >= 30 && ratio <= 70) band = 'mid';
  if (ratio > 70) band = 'high';
  const partial = payout(paid * (defect / total), paid);
  const half = payout(paid * 0.5, paid);
  return { ratio, band, paid, partial, half, full: paid };
}

function permissionNote(band, amount) {
  if (!POLICY_ON) {
    return '환불 규정의 현재 적용 여부가 확인되지 않았습니다. 금액은 검토용이며 환불을 실행하지 않습니다. 운영자 이민준에게 접수만 합니다.';
  }
  if (band === 'partial' && amount > AGENT_PARTIAL_LIMIT) {
    return '5만 원 초과 부분환불은 조합장 승인이 필요합니다. 챗봇은 조합장에게 직접 요청하지 않고 이민준에게 접수합니다.';
  }
  if (band === 'partial') return '상담 재량(5만 원 이하 부분환불)으로 접수할 수 있습니다.';
  return '하자가 확인된 전액환불·재배송은 문서상 상담 재량입니다. 실행 전 운영 기록에 남깁니다.';
}

function pack(outputs, quick) {
  const skillObj = skill(outputs, quick);
  const lines = [];
  for (const out of skillObj.template.outputs) {
    if (out.simpleText) lines.push(out.simpleText.text);
    if (out.basicCard) lines.push([out.basicCard.title, out.basicCard.description].filter(Boolean).join('\n'));
    if (out.carousel) {
      for (const item of out.carousel.items) lines.push([item.title, item.description].filter(Boolean).join('\n'));
    }
  }
  const labels = (skillObj.template.quickReplies || []).map((q) => q.label);
  if (labels.length) lines.push(`선택: ${labels.join(' · ')}`);
  return { text: clip(lines.join('\n\n'), 1000), skill: skillObj };
}

function skill(outputs, quick) {
  const template = { outputs: outputs.filter(Boolean).slice(0, 3) };
  if (quick && quick.length) {
    template.quickReplies = quick.slice(0, 10).map((q) => ({
      label: clip(q.label, 14),
      action: 'message',
      messageText: q.messageText || q.label,
    }));
  }
  return { version: '2.0', template };
}

function textOut(text) {
  return { simpleText: { text: clip(text, 1000) } };
}

function card(title, description, buttons) {
  const body = { title: clip(title, 50), description: clip(description, 230) };
  if (buttons && buttons.length) {
    body.buttons = buttons.slice(0, 3).map((b) => ({
      label: clip(b.label, 8),
      action: 'message',
      messageText: b.messageText,
    }));
  }
  return { basicCard: body };
}

const MENU_QR = [
  { label: '배송조회', messageText: '배송 조회' },
  { label: '주문확인', messageText: '주문 확인' },
  { label: '상품안내', messageText: '상품 안내' },
  { label: '하자접수', messageText: '하자 접수' },
  { label: '상담연결', messageText: '상담원 연결' },
];

function menu() {
  return pack([
    textOut([
      '교동마을 CS입니다. 확인된 기록만 안내합니다.',
      '',
      '조회 예시',
      'GD-20260605-0142 운송지연',
      'GD-20261020-0088 운송중',
      'GD-20261028-0031 배송완료',
      'GD-20261030-0102 포장완료',
    ].join('\n')),
  ], MENU_QR);
}

function askOrder(purpose) {
  const label = purpose === 'defect' ? '하자 접수' : purpose === 'order' ? '주문 확인' : '배송 조회';
  return pack([
    textOut(`${label}를 위해 주문번호가 필요합니다.\n예: GD-20260605-0142\n없는 주문은 추측해서 안내하지 않습니다.`),
  ], MENU_QR);
}

function unknownOrder(no) {
  return pack([
    textOut(`${no}는 등록된 주문에서 확인되지 않습니다.\n주문번호를 다시 확인해 주세요. 확인되지 않은 상태는 안내하지 않습니다.`),
  ], MENU_QR);
}

function statusLine(order) {
  if (order.status === 'delivered' && order.deliveredAt) return '배송 완료로 확인됩니다.';
  if (order.status === 'suspended') return '기상 상황으로 운송이 지연되고 있습니다.';
  if (order.status === 'in_transit' && order.pickupAt) return '상품이 배송 과정에 있습니다.';
  if (order.status === 'packed') return '상품 포장이 완료되었습니다.';
  if (order.pickupAt) return '택배사가 상품을 인수했습니다.';
  if (order.invoiceAt) return '배송 송장이 등록되었습니다.';
  return '주문이 접수되었습니다.';
}

function deliveryCard(order) {
  const p = productOf(order);
  const lines = [
    `${order.orderNo}`,
    `${p.name} ${order.qty}개`,
    statusLine(order),
    order.invoiceAt ? `송장 등록 ${order.invoiceAt}` : '송장 등록 전',
    order.pickupAt ? `집하 ${order.pickupAt}. 택배사가 상품을 인수했습니다.` : '집하 전. 택배사 인수 아님',
    order.deliveredAt ? `배송 완료 ${order.deliveredAt}` : '배송 완료 기록 없음',
    '송장 등록은 발송 완료가 아닙니다.',
  ];
  return card('배송 현황', lines.join('\n'), [
    { label: '상세기록', messageText: `상세 ${order.orderNo}` },
    { label: '하자접수', messageText: `하자 접수 ${order.orderNo}` },
    { label: '상담연결', messageText: '상담원 연결' },
  ]);
}

function orderCard(order) {
  const p = productOf(order);
  return card('주문 확인', [
    order.orderNo,
    `${p.name} ${order.qty}개`,
    `실결제 ${won(order.paid)}`,
    `결제 ${order.payStatus}`,
    `채널 ${order.channel}`,
    `접수 ${order.orderedAt}`,
    '취소는 여기서 실행하지 않습니다.',
  ].join('\n'), [
    { label: '배송조회', messageText: `배송 조회 ${order.orderNo}` },
    { label: '상담연결', messageText: '상담원 연결' },
  ]);
}

function timelineText(order) {
  const extra = order.unverified.length
    ? `\n\n확인된 기록 없음: ${order.unverified.join(', ')}. 이 항목은 안내하지 않습니다.`
    : '';
  return `확인된 기록 (${order.source}, ${order.updatedAt})\n${order.timeline.map((row) => `• ${row}`).join('\n')}${extra}`;
}

function deliveryView(order) {
  return pack([orderCard(order), deliveryCard(order), textOut(timelineText(order))], MENU_QR);
}

function orderView(order) {
  return pack([orderCard(order), deliveryCard(order)], MENU_QR);
}

function productCard(item) {
  return {
    title: clip(item.name, 50),
    description: clip([
      `가격 ${won(item.price)}`,
      `규격 ${item.spec}`,
      `구성 ${item.composition}`,
      `원산지 ${item.origin}`,
      `보관 ${item.storage}`,
      `출처 ${item.source}`,
      '승인된 프로모션 없음',
    ].join('\n'), 230),
    buttons: [{ label: '상담연결', action: 'message', messageText: '상담원 연결' }],
  };
}

function productView(text) {
  const n = norm(text);
  let list = Object.values(PRODUCTS);
  if (n.includes('망고')) list = list.filter((p) => p.name.includes('망고'));
  else if (n.includes('수박')) list = list.filter((p) => p.name.includes('수박'));
  else if (n.includes('멜론')) list = list.filter((p) => p.name.includes('멜론'));
  if (list.length === 1) {
    const item = list[0];
    return pack([card(item.name, productCard(item).description)], MENU_QR);
  }
  return pack([{
    carousel: { type: 'basicCard', items: list.map(productCard) },
  }], MENU_QR);
}

function promoView() {
  return pack([
    textOut('승인된 쿠폰·프로모션·할인 기록이 없습니다. 없는 할인 조건은 안내하지 않습니다. 미래 주문에 무료배송이나 할인을 약속하지 않습니다.'),
  ], MENU_QR);
}

function classify(text) {
  const n = norm(text);
  if (n.startsWith('환불선택') || n.startsWith('상세')) return 'command';
  if (/상담원|상담연결|사람연결|직원/.test(n)) return 'escalate';
  if (/무료배송|할인약속|무조건/.test(n)) return 'no_promise';
  if (/쿠폰|프로모션|이벤트|할인/.test(n)) return 'promo';
  if (/하자|불량|파손|환불|곰팡|썩었|악취/.test(n)) return 'defect';
  if (/배송|송장|도착|집하|결항|지연/.test(n)) return 'delivery';
  if (/취소/.test(n)) return 'cancel';
  if (/주문|결제/.test(n)) return 'order';
  if (/상품|가격|규격|망고|수박|멜론|보관|원산지/.test(n)) return 'product';
  if (/메뉴|안녕|시작|도움말/.test(n)) return 'menu';
  if (findOrderNo(text)) return 'lookup';
  return 'unknown';
}

function isMenuCommand(text) {
  const n = norm(text);
  return ['메뉴', '안녕', '안녕하세요', '시작', '배송조회', '배송', '주문확인', '주문', '상품안내', '상품', '하자접수', '하자', '상담원연결', '상담연결', '상담원'].includes(n);
}

function sessionOf(userId) {
  const now = Date.now();
  for (const [key, value] of sessions) {
    if (now - value.updated > 30 * 60 * 1000) sessions.delete(key);
  }
  if (!sessions.has(userId)) {
    sessions.set(userId, { mode: 'idle', purpose: null, orderNo: null, defect: null, total: null, hygiene: false, updated: now });
  }
  const row = sessions.get(userId);
  row.updated = now;
  return row;
}

function reset(row) {
  row.mode = 'idle';
  row.purpose = null;
  row.orderNo = null;
  row.defect = null;
  row.total = null;
  row.hygiene = false;
}

function hygieneHit(text) {
  return /곰팡|썩|악취|벌레|변질|위생/.test(text);
}

function openTicket(fields) {
  const ticket = {
    id: `CS-${(++seq).toString(36).toUpperCase()}`,
    at: new Date().toISOString(),
    escalateTo: '이민준',
    policyConfirmed: POLICY_ON,
    ...fields,
  };
  tickets.push(ticket);
  return ticket;
}

function escalate(reason, orderNo) {
  const ticket = openTicket({ type: 'escalate', reason, orderNo: orderNo || null });
  return pack([
    card('담당자 접수', [
      `접수번호 ${ticket.id}`,
      `사유 ${reason}`,
      orderNo ? `주문 ${orderNo}` : '주문번호 없음',
      '이관: 운영자 이민준',
      '조합장에게 직접 승인 요청을 보내지 않습니다.',
    ].join('\n'), [
      { label: '메뉴', messageText: '메뉴' },
    ]),
  ], MENU_QR);
}

function parsePair(text) {
  let m = String(text).match(/(\d+)\s*\/\s*(\d+)/);
  if (m) return { defect: Number(m[1]), total: Number(m[2]) };
  const d = String(text).match(/하자\D*(\d+)/);
  const t = String(text).match(/전체\D*(\d+)/);
  if (d && t) return { defect: Number(d[1]), total: Number(t[1]) };
  return null;
}

function askDefect(order) {
  const p = productOf(order);
  return pack([
    textOut(`${order.orderNo} ${p.name}\n하자 개수와 전체 개수를 보내 주세요.\n예: 2/10\n사진이 없어도 진술로 개수를 받을 수 있습니다.`),
  ], MENU_QR);
}

function resultView(order, quote, hygiene) {
  const p = productOf(order);
  const head = hygiene ? '섭취를 중단하고 해당 상품은 폐기하십시오.\n' : '';
  let body;
  let buttons;
  if (quote.band === 'partial') {
    body = `부분환불 검토 ${won(quote.partial)}\n비율 ${quote.ratio}% (30% 미만)\n실결제 ${won(quote.paid)} 기준, 배송비 제외\n답장: 접수`;
    buttons = [
      { label: '접수하기', messageText: `환불선택 부분 ${order.orderNo}` },
      { label: '상담연결', messageText: '상담원 연결' },
    ];
  } else if (quote.band === 'mid') {
    body = `비율 ${quote.ratio}% (30~70%)\n선택: 50% 검토 ${won(quote.half)} 또는 전량 재배송\n재배송이면 환불은 중복하지 않습니다.\n답장: 50% 또는 재배송`;
    buttons = [
      { label: '50%환불', messageText: `환불선택 50 ${order.orderNo}` },
      { label: '재배송', messageText: `환불선택 재배송 ${order.orderNo}` },
      { label: '상담연결', messageText: '상담원 연결' },
    ];
  } else {
    body = `비율 ${quote.ratio}% (70% 초과)\n선택: 전액 검토 ${won(quote.full)} 또는 전량 재배송\n재배송이면 환불은 중복하지 않습니다.\n답장: 전액 또는 재배송`;
    buttons = [
      { label: '전액환불', messageText: `환불선택 전액 ${order.orderNo}` },
      { label: '재배송', messageText: `환불선택 재배송 ${order.orderNo}` },
      { label: '상담연결', messageText: '상담원 연결' },
    ];
  }
  const note = permissionNote(quote.band, quote.band === 'partial' ? quote.partial : quote.full);
  return pack([
    textOut(`${head}${note}`),
    card(`${p.name} 하자 검토`, body, buttons),
  ], MENU_QR);
}

function choiceAction(text, band) {
  const n = norm(text);
  if (n.includes('재배송') && band !== 'partial') return 'reship';
  if (n.includes('전액') && band === 'high') return 'full';
  if (n.includes('50') && band === 'mid') return 'half';
  if ((n.includes('부분') || n.includes('접수')) && band === 'partial') return 'partial';
  return null;
}

function takeChoice(text, row) {
  const orderNo = findOrderNo(text) || row.orderNo;
  const order = ORDERS[orderNo];
  if (!order || row.defect == null || row.total == null) {
    row.mode = 'need_order';
    row.purpose = 'defect';
    return askOrder('defect');
  }
  const quote = quoteRefund(order, row.defect, row.total);
  if (quote.error) return pack([textOut(quote.error)], MENU_QR);
  const action = choiceAction(text, quote.band);
  if (!action) return resultView(order, quote, row.hygiene);
  const amount = { partial: quote.partial, half: quote.half, full: quote.full, reship: 0 }[action];
  const ticket = openTicket({
    type: 'refund_review',
    orderNo: order.orderNo,
    action,
    amount,
    ratio: quote.ratio,
    defect: row.defect,
    total: row.total,
    hygiene: row.hygiene,
  });
  reset(row);
  const actionLabel = { partial: '부분환불 검토', half: '50% 환불 검토', full: '전액환불 검토', reship: '전량 재배송 검토' }[action];
  return pack([
    card('접수만 완료', [
      `접수번호 ${ticket.id}`,
      `${actionLabel} ${action === 'reship' ? '환불 없음' : won(amount)}`,
      '확정 환불 아님',
      '이관: 운영자 이민준',
      '조합장 직접 요청 없음',
    ].join('\n')),
    textOut(permissionNote(action === 'partial' ? 'partial' : 'high', amount)),
  ], MENU_QR);
}

function takeHygiene(text, row) {
  const n = norm(text);
  if (/^(예|네|있어요|있음|응)/.test(n) || hygieneHit(text)) row.hygiene = true;
  else if (/^(아니|아니오|없어요|없음)/.test(n)) row.hygiene = false;
  else return pack([textOut('위생 위해(곰팡이, 악취, 벌레)가 있으면 "예", 없으면 "아니오"라고 답해 주세요.')], MENU_QR);
  const order = ORDERS[row.orderNo];
  const quote = quoteRefund(order, row.defect, row.total);
  row.mode = 'need_choice';
  return resultView(order, quote, row.hygiene);
}

function takeDefect(text, row) {
  const pair = parsePair(text);
  if (!pair) return pack([textOut('형식이 확인되지 않습니다. 하자개수/전체개수 로 보내 주세요. 예: 2/10')], MENU_QR);
  if (pair.defect === 0) {
    return pack([textOut('하자 개수가 0이면 환불 검토를 하지 않습니다. 예: 2/10')], MENU_QR);
  }
  if (pair.defect > pair.total || pair.total <= 0) {
    return pack([textOut('하자 개수는 전체 개수보다 클 수 없습니다. 예: 2/10')], MENU_QR);
  }
  row.defect = pair.defect;
  row.total = pair.total;
  if (hygieneHit(text)) {
    row.hygiene = true;
    row.mode = 'need_choice';
    return resultView(ORDERS[row.orderNo], quoteRefund(ORDERS[row.orderNo], pair.defect, pair.total), true);
  }
  row.mode = 'need_hygiene';
  return pack([textOut('위생 위해(곰팡이, 악취, 벌레, 변질)가 있습니까?\n예 또는 아니오로 답해 주세요. 있으면 섭취 중단과 폐기가 우선입니다.')], MENU_QR);
}

function startDefect(order, row) {
  row.mode = 'need_defect';
  row.purpose = 'defect';
  row.orderNo = order.orderNo;
  row.defect = null;
  row.total = null;
  row.hygiene = false;
  return askDefect(order);
}

function takeOrder(text, row) {
  const no = findOrderNo(text);
  if (!no) return askOrder(row.purpose || 'delivery');
  const order = ORDERS[no];
  if (!order) return unknownOrder(no);
  if (row.purpose === 'defect') return startDefect(order, row);
  row.mode = 'idle';
  row.orderNo = no;
  if (row.purpose === 'order') return orderView(order);
  return deliveryView(order);
}

function dispatch(text, row) {
  if (norm(text).startsWith('환불선택')) return takeChoice(text, row);
  if (norm(text).startsWith('상세')) {
    const order = ORDERS[findOrderNo(text)];
    if (!order) return unknownOrder(findOrderNo(text) || '주문번호');
    return pack([textOut(timelineText(order))], MENU_QR);
  }
  const kind = classify(text);
  const no = findOrderNo(text);
  if (kind === 'menu') return menu();
  if (kind === 'promo' || kind === 'no_promise') return promoView();
  if (kind === 'product') return productView(text);
  if (kind === 'escalate') return escalate('고객 상담 연결', no);
  if (kind === 'cancel') return escalate('주문 취소 요청. 챗봇은 취소 실행 안 함', no);
  if (kind === 'defect') {
    row.purpose = 'defect';
    if (no && ORDERS[no]) return startDefect(ORDERS[no], row);
    row.mode = 'need_order';
    return askOrder('defect');
  }
  if (kind === 'order' || kind === 'delivery' || kind === 'lookup') {
    row.purpose = kind === 'order' ? 'order' : 'delivery';
    if (no && ORDERS[no]) {
      row.orderNo = no;
      row.mode = 'idle';
      return kind === 'order' ? orderView(ORDERS[no]) : deliveryView(ORDERS[no]);
    }
    if (no) return unknownOrder(no);
    row.mode = 'need_order';
    return askOrder(row.purpose);
  }
  return pack([
    textOut('확인되지 않은 내용입니다. 주문번호, 배송, 상품, 하자 중 하나로 다시 말씀해 주세요. 없는 사실은 만들지 않습니다.'),
  ], MENU_QR);
}

function handleMessage(content, userId = 'default') {
  const text = String(content || '').trim().slice(0, 500);
  const row = sessionOf(String(userId || 'default'));
  if (!text) return menu();
  if (isMenuCommand(text)) {
    reset(row);
    return dispatch(text, row);
  }
  if (row.mode === 'need_order') return takeOrder(text, row);
  if (row.mode === 'need_defect') return takeDefect(text, row);
  if (row.mode === 'need_hygiene') return takeHygiene(text, row);
  if (row.mode === 'need_choice') return takeChoice(text, row);
  return dispatch(text, row);
}

function createApp() {
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const PORT = process.env.PORT || 3000;
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CALLBACK_TOKEN = process.env.CALLBACK_TOKEN || process.env.X_BOT_CALLBACK_TOKEN || '';
  const WEBHOOK_HEADER_NAME = process.env.WEBHOOK_HEADER_NAME;
  const WEBHOOK_HEADER_VALUE = process.env.WEBHOOK_HEADER_VALUE;

  app.get('/healthz', (req, res) => res.status(200).send('ok - gyodong cjs'));
  app.get('/', (req, res) => {
    res.json({
      service: 'gyodong',
      bot_token: !!BOT_TOKEN,
      callback_token: !!CALLBACK_TOKEN,
      critical: '송장등록≠발송완료, 포장완료≠집하완료, 집하완료≠배송완료',
    });
  });
  app.get('/debug/env', (req, res) => {
    res.json({
      has_bot_token: !!BOT_TOKEN,
      has_callback_token: !!CALLBACK_TOKEN,
      has_webhook_header: !!(WEBHOOK_HEADER_NAME && WEBHOOK_HEADER_VALUE),
      port: PORT,
      node_version: process.version,
    });
  });

  function chatIdOf(d) {
    return d.chatId || (d.chat && d.chat.id) || d.chat_id || d.channelId || null;
  }

  function textOf(d) {
    return String((d.message && (d.message.text || d.message.content)) || d.text || d.content || d.utterance || '');
  }

  async function sendCallback(d, out) {
    if (!BOT_TOKEN) {
      console.error('[CALLBACK] BOT_TOKEN 없음');
      return;
    }
    const chatId = chatIdOf(d);
    const token = d.callbackToken || CALLBACK_TOKEN;
    const headers = {
      Authorization: `KakaoAK ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    };
    if (token) headers['X-Bot-Callback-Token'] = token;
    const body = chatId
      ? JSON.stringify({ chatId, text: out.text })
      : JSON.stringify({ skillResponse: out.skill });
    try {
      const r = await fetch('https://kapi.kakao.com/v1/bot/callback', { method: 'POST', headers, body });
      const txt = await r.text();
      console.log('[CALLBACK]', r.status, txt.slice(0, 300));
    } catch (e) {
      console.error('[CALLBACK] fetch error', e.message);
    }
  }

  app.post('/kakao/webhook', (req, res) => {
    res.status(204).end();
    if (WEBHOOK_HEADER_NAME && WEBHOOK_HEADER_VALUE) {
      const hv = req.get(WEBHOOK_HEADER_NAME);
      if (hv !== WEBHOOK_HEADER_VALUE) {
        console.warn('[WEBHOOK] header mismatch');
        return;
      }
    }
    const body = req.body || {};
    console.log('[WEBHOOK]', JSON.stringify(body).slice(0, 2000));
    if (body.op !== 0 || body.t !== 'MESSAGE_CREATE') return;
    const d = body.d || {};
    const chatId = chatIdOf(d);
    const userMessage = textOf(d).trim();
    if (!userMessage) return;
    if (!chatId && !d.callbackToken) {
      console.error('[WEBHOOK] chatId missing');
      return;
    }
    let out;
    try {
      out = handleMessage(userMessage, String(chatId || d.userId || 'default'));
    } catch (e) {
      console.error('[HANDLE]', e.message);
      out = { text: '확인 중 오류가 났습니다. 주문번호로 다시 조회해 주세요.', skill: { version: '2.0', template: { outputs: [{ simpleText: { text: '확인 중 오류가 났습니다.' } }] } } };
    }
    sendCallback(d, out);
  });

  app.post('/kakao/skill', (req, res) => {
    const u = (req.body && req.body.userRequest) || {};
    const id = (u.user && u.user.id) || 'skill';
    res.json(handleMessage(u.utterance || '', id).skill);
  });

  app.post('/kakao/preview', (req, res) => {
    const body = req.body || {};
    res.json(handleMessage(body.content || body.utterance || '', body.userId || 'preview'));
  });

  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log('listening on', port));
}

module.exports = { handleMessage, ratioOf, quoteRefund, ORDERS, tickets, payout };
