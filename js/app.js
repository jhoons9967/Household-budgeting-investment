/* ================= 가계부 · 투자일지 =================
 * 순수 JS · 데이터는 localStorage 저장 (기기별)
 * 거래 유형: 수입 / 지출 / 적금 / 투자이체
 *   - 수입·적금·투자이체 = 자산으로 쌓이는 돈, 지출 = 나가는 돈
 *   - 적금·투자이체는 현금→적금/투자로의 '이동'이라 총자산은 불변
 * =================================================== */

const LS = {
  tx:   'gb.tx',        // 거래 배열
  set:  'gb.settings',  // 시작 자산 · 목표 (모두 ₩ 기준)
  rate: 'gb.rate',      // 환율 ₩/$1
};

const TYPES = ['수입', '지출', '적금', '투자이체'];

// ---------- 상태 ----------
let txs   = load(LS.tx, []);
let setg  = load(LS.set, { startCash: 0, startSave: 0, startInvest: 0, goal: 0 });
let rate  = Number(load(LS.rate, 1350)) || 1350;

let view = { year: null, month: null, cum: false };

// ---------- 유틸 ----------
function load(k, def) {
  try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); }
  catch { return def; }
}
function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

// 로컬 저장 + (로그인 상태면) Firebase 동기화로 전달
function persist() {
  save(LS.tx, txs);
  save(LS.set, setg);
  save(LS.rate, rate);
  if (window.gbStore && typeof window.gbStore.save === 'function') {
    window.gbStore.save(window.gbSnapshot());
  }
}

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// 문자열/입력값 → 숫자 (₩ 콤마·공백 허용)
function parseNum(v) {
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}
// 거래 금액을 ₩로 환산
function toKRW(t) { return t.cur === 'USD' ? t.amt * rate : t.amt; }

// 포맷
function fmtKRW(v) {
  const r = Math.round(v);
  return '₩' + r.toLocaleString('ko-KR');
}
function fmtUSD(v) {
  return '$' + (v / rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// 한 쌍(₩ + $) 셀 채우기
function pair(kId, uId, krw) {
  const k = $('#' + kId), u = $('#' + uId);
  if (k) k.textContent = fmtKRW(krw);
  if (u) u.textContent = fmtUSD(krw);
}

// ================= 렌더링 =================
function renderAll() {
  renderAsset();
  renderLedger();
  renderGgList();
  renderInvest();
}

// ---------- 자산 현황 ----------
function totals() {
  // 전체 기간 합계 (₩)
  let income = 0, expense = 0, saveT = 0, invest = 0;
  for (const t of txs) {
    const k = toKRW(t);
    if (t.type === '수입') income += k;
    else if (t.type === '지출') expense += k;
    else if (t.type === '적금') saveT += k;
    else if (t.type === '투자이체') invest += k;
  }
  const startCash = +setg.startCash || 0;
  const startSave = +setg.startSave || 0;
  const startInvest = +setg.startInvest || 0;

  const cash   = startCash + income - expense - saveT - invest;
  const saveB  = startSave + saveT;
  const investB = startInvest + invest;
  const total  = startCash + startSave + startInvest + income - expense; // = cash+saveB+investB
  return { income, expense, saveT, invest, cash, saveB, investB, total };
}

function renderAsset() {
  const t = totals();
  pair('aTotalK', 'aTotalU', t.total);
  pair('aCashK', 'aCashU', t.cash);
  pair('aSaveK', 'aSaveU', t.saveB);
  pair('aInvestK', 'aInvestU', t.investB);

  const goal = +setg.goal || 0;
  const wrap = $('#goalWrap');
  if (goal > 0) {
    wrap.hidden = false;
    const pct = Math.max(0, t.total / goal * 100);
    $('#goalFill').style.width = Math.min(100, pct) + '%';
    $('#goalPct').textContent = pct.toFixed(1) + '%';
    $('#goalSub').textContent = fmtKRW(t.total) + ' / ' + fmtKRW(goal);
  } else {
    wrap.hidden = true;
  }
}

// ---------- 가계부 요약/목록 ----------
function inPeriod(t) {
  if (view.cum) return true;
  const d = new Date(t.date);
  return d.getFullYear() === view.year && (d.getMonth() + 1) === view.month;
}

function renderLedger() {
  const sel = txs.filter(inPeriod);
  let income = 0, expense = 0, saveT = 0, invest = 0;
  for (const t of sel) {
    const k = toKRW(t);
    if (t.type === '수입') income += k;
    else if (t.type === '지출') expense += k;
    else if (t.type === '적금') saveT += k;
    else if (t.type === '투자이체') invest += k;
  }
  pair('inK', 'inU', income);
  pair('exK', 'exU', expense);
  pair('saK', 'saU', saveT);
  pair('ivK', 'ivU', invest);

  const net = income - expense - saveT - invest; // 잉여현금
  const nk = $('#netK'), nu = $('#netU');
  nk.textContent = fmtKRW(net); nu.textContent = fmtUSD(net);
  nk.className = 'krw num ' + (net > 0 ? 'pos' : net < 0 ? 'neg' : '');

  $('#ggCap').textContent = view.cum ? '전체 누적 요약' : `${view.year}년 ${view.month}월 요약`;
  $('#ggSub').textContent = `${sel.length}건`;
  $('#ggListTitle').textContent = view.cum ? '전체 거래 내역' : `${view.month}월 거래 내역`;
}

const BADGE = { '수입': 'b-in', '지출': 'b-ex', '적금': 'b-sa', '투자이체': 'b-iv' };

function renderGgList() {
  const sel = txs.filter(inPeriod).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const box = $('#ggList');
  $('#ggCnt').textContent = sel.length ? `${sel.length}건` : '';
  if (!sel.length) {
    box.innerHTML = `<div class="empty">이 기간에 거래가 없습니다<span>아래 폼에서 거래를 추가해 보세요</span></div>`;
    return;
  }
  box.innerHTML = sel.map(t => {
    const krw = toKRW(t);
    const md = (t.date || '').slice(5);
    const sign = t.type === '수입' ? '+' : '−';
    const catLine = [t.cat, t.memo].filter(Boolean).join(' · ');
    return `<div class="tr gg">
      <div class="d num">${md}</div>
      <div class="badge ${BADGE[t.type]}">${t.type}</div>
      <div class="desc"><div class="m">${esc(t.memo || t.cat || '(내용 없음)')}</div><div class="c">${catLine ? esc(catLine) : '&nbsp;'}</div></div>
      <div class="amt"><div class="k num">${sign}${fmtKRW(krw)}</div><div class="u num">${t.cur === 'USD' ? '$' + t.amt.toLocaleString('en-US', {minimumFractionDigits:2}) : fmtUSD(krw)}</div></div>
      <button class="del" data-del="${t.id}" title="삭제">✕</button>
    </div>`;
  }).join('');
}

// ---------- 투자일지 (적금·투자이체 자동 집계) ----------
function renderInvest() {
  const feed = txs.filter(t => t.type === '적금' || t.type === '투자이체')
                  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  let saveT = 0, invest = 0;
  const kinds = {}; // 적금 종류별 누적
  for (const t of txs) {
    if (t.type === '적금') {
      saveT += toKRW(t);
      const key = (t.cat || '기타').trim() || '기타';
      kinds[key] = kinds[key] || { krw: 0, n: 0 };
      kinds[key].krw += toKRW(t); kinds[key].n++;
    } else if (t.type === '투자이체') {
      invest += toKRW(t);
    }
  }
  pair('tSaveK', 'tSaveU', saveT);
  pair('tInvK', 'tInvU', invest);
  pair('tAllK', 'tAllU', saveT + invest);

  // 적금 종류별
  const kEntries = Object.entries(kinds).sort((a, b) => b[1].krw - a[1].krw);
  const kBox = $('#kindTbl');
  $('#kindCnt').textContent = kEntries.length ? `${kEntries.length}종` : '';
  if (!kEntries.length) {
    kBox.innerHTML = `<div class="empty">적금 거래가 없습니다<span>가계부에서 유형 '적금'으로 추가하면 여기에 모입니다</span></div>`;
  } else {
    kBox.innerHTML = kEntries.map(([name, v]) => `
      <div class="tr kind">
        <div class="kn">${esc(name)}</div>
        <div class="kc num">${v.n}회</div>
        <div class="kk num">${fmtKRW(v.krw)}</div>
      </div>`).join('');
  }

  // 투입 내역
  const box = $('#ivList');
  $('#ivCnt').textContent = feed.length ? `${feed.length}건` : '';
  if (!feed.length) {
    box.innerHTML = `<div class="empty">투입 내역이 없습니다<span>적금·투자이체 거래가 자동으로 모입니다</span></div>`;
    return;
  }
  box.innerHTML = feed.map(t => {
    const krw = toKRW(t);
    const md = (t.date || '').slice(5);
    const catLine = [t.cat, t.memo].filter(Boolean).join(' · ');
    return `<div class="tr iv">
      <div class="d num">${md}</div>
      <div class="badge ${BADGE[t.type]}">${t.type}</div>
      <div class="desc"><div class="m">${esc(t.memo || t.cat || '(내용 없음)')}</div><div class="c">${catLine ? esc(catLine) : '&nbsp;'}</div></div>
      <div class="amt"><div class="k num">${fmtKRW(krw)}</div><div class="u num">${t.cur === 'USD' ? '$' + t.amt.toLocaleString('en-US', {minimumFractionDigits:2}) : fmtUSD(krw)}</div></div>
    </div>`;
  }).join('');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ================= 이벤트 =================
// 기간 셀렉트 채우기
function buildPeriodSelects() {
  const now = new Date();
  const years = new Set([now.getFullYear()]);
  txs.forEach(t => { const y = new Date(t.date).getFullYear(); if (y) years.add(y); });
  const yArr = [...years].sort((a, b) => b - a);

  const yS = $('#yearSel'), mS = $('#monthSel');
  yS.innerHTML = yArr.map(y => `<option value="${y}">${y}년</option>`).join('');
  mS.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}월</option>`).join('');

  view.year = view.year && yArr.includes(view.year) ? view.year : now.getFullYear();
  view.month = view.month || (now.getMonth() + 1);
  yS.value = view.year; mS.value = view.month;
}

function wire() {
  // 탭 전환
  $$('.tab').forEach(b => b.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.remove('on'));
    $$('.pane').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    $('#pane-' + b.dataset.tab).classList.add('on');
  }));

  // 기간 선택
  $('#yearSel').addEventListener('change', e => { view.year = +e.target.value; renderLedger(); renderGgList(); });
  $('#monthSel').addEventListener('change', e => { view.month = +e.target.value; renderLedger(); renderGgList(); });
  $('#cumBtn').addEventListener('click', () => {
    view.cum = !view.cum;
    $('#cumBtn').classList.toggle('on', view.cum);
    $('#yearSel').disabled = view.cum;
    $('#monthSel').disabled = view.cum;
    renderLedger(); renderGgList();
  });

  // 유형에 따라 '분류' 라벨 전환 (적금 → 적금 종류)
  const typeSel = $('#gType'), catLab = $('#gCatLab'), catIn = $('#gCat');
  typeSel.addEventListener('change', () => {
    if (typeSel.value === '적금') { catLab.textContent = '적금 종류'; catIn.placeholder = '청년적금, 주택청약…'; }
    else { catLab.textContent = '분류'; catIn.placeholder = '월급, 식비…'; }
  });

  // 거래 추가
  $('#ggForm').addEventListener('submit', e => {
    e.preventDefault();
    const cur = $('#gCur').value;
    const amt = parseNum($('#gAmt').value);
    if (!amt) { $('#gAmt').focus(); return; }
    txs.push({
      id: uid(),
      date: $('#gDate').value || new Date().toISOString().slice(0, 10),
      type: typeSel.value,
      cat: $('#gCat').value.trim(),
      memo: $('#gMemo').value.trim(),
      amt: amt,
      cur: cur,
    });
    persist();
    e.target.reset();
    setDefaultDate();
    typeSel.dispatchEvent(new Event('change'));
    buildPeriodSelects();
    renderAll();
  });

  // 삭제 (위임)
  $('#ggList').addEventListener('click', e => {
    const id = e.target.dataset.del;
    if (!id) return;
    txs = txs.filter(t => t.id !== id);
    persist();
    buildPeriodSelects();
    renderAll();
  });

  // 환율
  const rateIn = $('#rate');
  rateIn.value = rate;
  rateIn.addEventListener('change', () => {
    const v = parseNum(rateIn.value);
    if (v > 0) { rate = v; persist(); $('#fxState').textContent = '입력값'; renderAll(); }
  });
  $('#fxBtn').addEventListener('click', fetchRate);

  // 설정 패널
  $('#setBtn').addEventListener('click', () => {
    const p = $('#setPanel');
    p.hidden = !p.hidden;
    if (!p.hidden) {
      $('#sCash').value = setg.startCash || '';
      $('#sSave').value = setg.startSave || '';
      $('#sInvest').value = setg.startInvest || '';
      $('#sGoal').value = setg.goal || '';
    }
  });
  $('#setCancel').addEventListener('click', () => { $('#setPanel').hidden = true; });
  $('#setSave').addEventListener('click', () => {
    setg = {
      startCash: parseNum($('#sCash').value),
      startSave: parseNum($('#sSave').value),
      startInvest: parseNum($('#sInvest').value),
      goal: parseNum($('#sGoal').value),
    };
    persist();
    $('#setPanel').hidden = true;
    renderAsset();
  });
}

function setDefaultDate() {
  $('#gDate').value = new Date().toISOString().slice(0, 10);
}

// 환율 자동 조회 (실패 시 입력값 유지)
async function fetchRate() {
  const st = $('#fxState');
  st.textContent = '조회 중…';
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    const krw = data && data.rates && data.rates.KRW;
    if (krw) {
      rate = Math.round(krw * 100) / 100;
      $('#rate').value = rate;
      persist();
      st.textContent = '자동 · ' + (data.time_last_update_utc ? data.time_last_update_utc.slice(5, 16) : '갱신');
      renderAll();
      return;
    }
    throw new Error('no rate');
  } catch {
    st.textContent = '조회 실패 · 입력값 사용';
  }
}

// ================= Firebase 연동 브릿지 =================
// 현재 상태 스냅샷 (Firestore에 저장할 형태)
window.gbSnapshot = function gbSnapshot() {
  return {
    items: txs,
    startCash: setg.startCash || 0,
    startSavings: setg.startSave || 0,
    startInvest: setg.startInvest || 0,
    goal: setg.goal || 0,
    rate: rate,
  };
};

// 원격(Firestore) 상태를 로컬 state에 반영 후 다시 그리기
window.gbReceive = function gbReceive(remote) {
  if (!remote || typeof remote !== 'object') return;
  txs = Array.isArray(remote.items) ? remote.items : [];
  setg = {
    startCash: +remote.startCash || 0,
    startSave: +remote.startSavings || 0,
    startInvest: +remote.startInvest || 0,
    goal: +remote.goal || 0,
  };
  rate = +remote.rate || rate;
  save(LS.tx, txs);
  save(LS.set, setg);
  save(LS.rate, rate);
  const rateIn = $('#rate');
  if (rateIn) rateIn.value = rate;
  buildPeriodSelects();
  renderAll();
};

// ================= 시작 =================
function init() {
  setDefaultDate();
  buildPeriodSelects();
  wire();
  renderAll();
  fetchRate(); // 백그라운드 자동 조회
}
init();
