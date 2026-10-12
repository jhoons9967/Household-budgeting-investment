/* ================= 가계부 · 투자일지 =================
 * 순수 JS · 데이터는 localStorage 저장 (기기별)
 * 거래 유형: 수입 / 적금 / 투자이체 (지출 개념 없음)
 *   - 수입·적금·투자이체 = 자산으로 쌓이는 돈
 *   - 적금·투자이체는 현금→적금/투자로의 '이동'이라 총자산은 불변
 *   - 레거시 '지출' 데이터가 남아있어도 요약/계산에서는 무시(0으로 취급)
 *
 * 시작 현금/적금/투자/보증금/목표금액은 ₩·$ 두 칸으로 입력받아
 * 각각 원시값으로 저장하고, 계산 시점의 현재 환율로 원화 환산해 합산한다.
 * =================================================== */

const LS = {
  tx:       'gb.tx',        // 거래 배열
  set:      'gb.settings',  // 시작 자산 · 목표
  rate:     'gb.rate',      // 환율 ₩/$1
  loans:    'gb.loans',     // 대출(마이너스 통장) 배열
  ilogs:    'gb.interestLogs', // 월별 이자 수동 기록 배열
  accounts: 'gb.accounts',  // 투자 계좌 배열
  holdings: 'gb.holdings',  // 보유 종목 배열
  realized: 'gb.realized',  // 실현손익 기록 배열
  updatedAt: 'gb.updatedAt', // 마지막 로컬 편집 시각 (원격 데이터 신선도 비교용)
};

const TYPES = ['수입', '적금', '투자이체'];

const SETG_DEFAULT = {
  startCashKRW: 0, startCashUSD: 0,
  startSaveKRW: 0, startSaveUSD: 0,
  startDepositKRW: 0, startDepositUSD: 0,
  goalKRW: 0, goalUSD: 0,
};

// ---------- 상태 ----------
let txs   = load(LS.tx, []);
let setg  = Object.assign({}, SETG_DEFAULT, load(LS.set, {}));
let rate  = Number(load(LS.rate, 1350)) || 1350;
let loans = load(LS.loans, []);            // { id, name, cur, start, end, balance, rate }
let interestLogs = load(LS.ilogs, []);     // { id, loanId, date(YYYY-MM), amount }
let accounts = load(LS.accounts, []);      // { id, name, cur, cash }
let holdings = load(LS.holdings, []);      // { id, accountId, name, avgPrice, qty, curPrice, category }
let realized = load(LS.realized, []);      // { id, date, accountName, holdingName, cur, qty, sellPrice, avgPrice, pnl, result, category }
let localUpdatedAt = Number(load(LS.updatedAt, 0)) || 0; // 이 기기의 마지막 편집 시각(ms)

let view = { year: null, month: null, cum: false };
let investOpen = false;         // 대시보드 '투자' 아코디언 전체 펼침 여부
let openAccounts = new Set();   // 대시보드 아코디언에서 개별로 펼친 계좌 id
let closingHoldingId = null;    // 투자일지 상세에서 '종료' 폼이 열려있는 종목 id

// ---------- 유틸 ----------
function load(k, def) {
  try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); }
  catch { return def; }
}
function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

// 로컬 저장 + (로그인 상태면) Firebase 동기화로 전달
// localUpdatedAt을 매번 갱신해둬야, 아직 서버에 반영되지 않은 "이전" 원격 데이터가
// 뒤늦게 도착해도 gbReceive에서 이를 감지하고 무시할 수 있다 (새로고침 시 데이터가
// 사라지는 경합 상태 방지).
function persist() {
  localUpdatedAt = Date.now();
  save(LS.tx, txs);
  save(LS.set, setg);
  save(LS.rate, rate);
  save(LS.loans, loans);
  save(LS.ilogs, interestLogs);
  save(LS.accounts, accounts);
  save(LS.holdings, holdings);
  save(LS.realized, realized);
  save(LS.updatedAt, localUpdatedAt);
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
// 입력 중인 문자열에 천 단위 콤마를 입혀 표시용으로 되돌림 (소수점 이하는 그대로 유지)
function formatThousands(raw) {
  let s = String(raw).replace(/[^0-9.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  let [intPart, decPart] = s.split('.');
  intPart = intPart.replace(/^0+(?=\d)/, '');
  const withComma = intPart ? Number(intPart).toLocaleString('en-US') : '';
  return decPart !== undefined ? withComma + '.' + decPart : withComma;
}
// 통화 접두(₩/$) 박스 안의 모든 금액 입력칸에 실시간 천 단위 콤마 적용 (위임 — 나중에
// 계좌·종목·대출 카드가 다시 그려져도 새로 등록할 필요 없음)
function wireAmountFormatting() {
  document.addEventListener('input', e => {
    if (!e.target.matches('.amt-field input.num, .fp-cur input.num')) return;
    const el = e.target;
    const atEnd = el.selectionStart === el.value.length;
    el.value = formatThousands(el.value);
    if (atEnd) { el.selectionStart = el.selectionEnd = el.value.length; }
  });
}
// 금액 입력칸 옆 통화 선택(select)이 바뀌면 접두 기호(₩/$)도 함께 갱신
function wireCurrencyPrefix(selectId, prefixId) {
  const sel = $('#' + selectId), pre = $('#' + prefixId);
  if (!sel || !pre) return;
  const update = () => { pre.textContent = sel.value === 'USD' ? '$' : '₩'; };
  sel.addEventListener('change', update);
  update();
}
// 거래 금액을 ₩로 환산
function toKRW(t) { return t.cur === 'USD' ? t.amt * rate : t.amt; }
// ₩ 입력값 + $ 입력값을 현재 환율로 합쳐 ₩ 기준 금액으로 변환
function pairKRW(krw, usd) { return (+krw || 0) + (+usd || 0) * rate; }
// 대출(마이너스 통장) 금액을 그 통장의 통화 기준으로 ₩ 환산
function loanToKRW(loan, amt) { return loan.cur === 'USD' ? (+amt || 0) * rate : (+amt || 0); }
// 계좌 금액을 그 계좌의 통화 기준으로 ₩ 환산
function acctToKRW(acct, amt) { return acct.cur === 'USD' ? (+amt || 0) * rate : (+amt || 0); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

// 포맷
function fmtKRW(v) {
  const r = Math.round(v);
  return '₩' + r.toLocaleString('ko-KR');
}
function fmtUSD(v) {
  return '$' + (v / rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// 원시 금액을 해당 통화 표기로 그대로 포맷 (환산 없이)
function fmtCur(cur, amt) {
  const n = +amt || 0;
  return cur === 'USD'
    ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : fmtKRW(n);
}
// 한 쌍(₩ + $) 셀 채우기
function pair(kId, uId, krw) {
  const k = $('#' + kId), u = $('#' + uId);
  if (k) k.textContent = fmtKRW(krw);
  if (u) u.textContent = fmtUSD(krw);
}
// 부호에 따라 pos/neg 클래스까지 입히는 쌍
function pairSigned(kId, uId, krw) {
  pair(kId, uId, krw);
  const cls = krw > 0 ? 'pos' : krw < 0 ? 'neg' : '';
  const k = $('#' + kId), u = $('#' + uId);
  if (k) k.className = 'krw num ' + cls;
  if (u) u.className = 'usd num ' + cls;
}

// ================= 렌더링 =================
function renderAll() {
  renderAsset();
  renderLedger();
  renderGgList();
  renderInvest();
  renderLoans();
  renderAccounts();
}

// ---------- 자산 현황 ----------
function totals() {
  // 전체 기간 합계 (₩) — 지출 등 알 수 없는 유형은 무시.
  // '투자이체'는 더 이상 투자 자산 계산에 쓰이지 않지만(투자는 계좌·종목 기준 자동계산),
  // 현금에서는 여전히 빠져나간 돈으로 취급해 잉여현금 흐름을 맞춘다.
  let income = 0, saveT = 0, investTx = 0;
  for (const t of txs) {
    const k = toKRW(t);
    if (t.type === '수입') income += k;
    else if (t.type === '적금') saveT += k;
    else if (t.type === '투자이체') investTx += k;
  }
  const startCash = pairKRW(setg.startCashKRW, setg.startCashUSD);
  const startSave = pairKRW(setg.startSaveKRW, setg.startSaveUSD);
  const startDeposit = pairKRW(setg.startDepositKRW, setg.startDepositUSD);

  const cash    = startCash + income - saveT - investTx;
  const saveB   = startSave + saveT;
  const investB = investTotalKRW(); // 자동계산: 모든 계좌 예수금 + 모든 보유 종목 평가금액
  const depositB = startDeposit; // 보증금은 거래로 증감되지 않는 고정 자산
  const total   = cash + saveB + investB + depositB;
  return { income, saveT, investTx, cash, saveB, investB, depositB, total };
}

function renderAsset() {
  const t = totals();
  pair('aTotalK', 'aTotalU', t.total);
  pair('aCashK', 'aCashU', t.cash);
  pair('aSaveK', 'aSaveU', t.saveB);
  pair('aInvestK', 'aInvestU', t.investB);
  pair('aDepositK', 'aDepositU', t.depositB);

  const goal = pairKRW(setg.goalKRW, setg.goalUSD);
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

  renderInvestAccordion();
}

// ---------- 가계부 요약/목록 ----------
function inPeriod(t) {
  if (view.cum) return true;
  const d = new Date(t.date);
  return d.getFullYear() === view.year && (d.getMonth() + 1) === view.month;
}

function renderLedger() {
  const sel = txs.filter(inPeriod);
  let income = 0, saveT = 0, invest = 0;
  for (const t of sel) {
    const k = toKRW(t);
    if (t.type === '수입') income += k;
    else if (t.type === '적금') saveT += k;
    else if (t.type === '투자이체') invest += k;
  }
  pair('inK', 'inU', income);
  pair('saK', 'saU', saveT);
  pair('ivK', 'ivU', invest);

  const net = income - saveT - invest; // 잉여현금 = 수입 − 적금 − 투자이체
  pairSigned('netK', 'netU', net);

  $('#ggCap').textContent = view.cum ? '전체 누적 요약' : `${view.year}년 ${view.month}월 요약`;
  $('#ggSub').textContent = `${sel.length}건`;
  $('#ggListTitle').textContent = view.cum ? '전체 거래 내역' : `${view.month}월 거래 내역`;
}

// b-ex(지출) 배지는 레거시 데이터가 목록에 남아있을 때를 위해 유지
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
      <div class="badge ${BADGE[t.type] || 'b-in'}">${esc(t.type)}</div>
      <div class="desc"><div class="m">${esc(t.memo || t.cat || '(내용 없음)')}</div><div class="c">${catLine ? esc(catLine) : '&nbsp;'}</div></div>
      <div class="amt"><div class="k num">${sign}${fmtKRW(krw)}</div><div class="u num">${t.cur === 'USD' ? '$' + t.amt.toLocaleString('en-US', {minimumFractionDigits:2}) : fmtUSD(krw)}</div></div>
      <button class="del" data-del="${t.id}" title="삭제">✕</button>
    </div>`;
  }).join('');
}

// ---------- 대출(마이너스 통장) 집계 ----------
// 모든 통장의 '현재 사용액' 합계 (₩ 환산)
function totalLoanBalanceKRW() {
  return loans.reduce((s, l) => s + loanToKRW(l, l.balance), 0);
}
// 모든 통장의 월별 수동 이자 기록 합계 (₩ 환산) — 통장이 삭제되면 그 통장의 기록도 함께 삭제되므로
// 고아 기록(loanId가 없는 통장)은 정상적으로는 발생하지 않지만 방어적으로 무시한다.
function totalInterestKRW() {
  return interestLogs.reduce((s, log) => {
    const loan = loans.find(l => l.id === log.loanId);
    return loan ? s + loanToKRW(loan, log.amount) : s;
  }, 0);
}

// ---------- 계좌 · 보유 종목 (투자 = 예수금 + 평가금액, 자동계산) ----------
// 종목 금액은 그 종목이 속한 계좌의 통화 기준 (환산 없이) 그대로 계산
function holdingValue(h) { return (+h.qty || 0) * (+h.curPrice || 0); }
function holdingCost(h) { return (+h.qty || 0) * (+h.avgPrice || 0); }
function holdingPnL(h) { return holdingValue(h) - holdingCost(h); }

function accountHoldingsValueKRW(a) {
  return holdings.filter(h => h.accountId === a.id).reduce((s, h) => s + acctToKRW(a, holdingValue(h)), 0);
}
function accountTotalKRW(a) {
  return acctToKRW(a, a.cash) + accountHoldingsValueKRW(a);
}
function totalAccountsCashKRW() {
  return accounts.reduce((s, a) => s + acctToKRW(a, a.cash), 0);
}
function totalHoldingsValueKRW() {
  return accounts.reduce((s, a) => s + accountHoldingsValueKRW(a), 0);
}
// 대시보드 '투자' = 모든 계좌 예수금 합 + 모든 종목 평가금액 합
function investTotalKRW() {
  return totalAccountsCashKRW() + totalHoldingsValueKRW();
}
function totalHoldingsPnLKRW() {
  return accounts.reduce((s, a) => {
    return s + holdings.filter(h => h.accountId === a.id).reduce((s2, h) => s2 + acctToKRW(a, holdingPnL(h)), 0);
  }, 0);
}
function totalHoldingsCostKRW() {
  return accounts.reduce((s, a) => {
    return s + holdings.filter(h => h.accountId === a.id).reduce((s2, h) => s2 + acctToKRW(a, holdingCost(h)), 0);
  }, 0);
}

// ---------- 실현손익 (종목 종료·부분익절) ----------
function realizedToKRW(r) { return r.cur === 'USD' ? (+r.pnl || 0) * rate : (+r.pnl || 0); }
function totalRealizedKRW() { return realized.reduce((s, r) => s + realizedToKRW(r), 0); }
function totalRealizedByResultKRW(result) {
  return realized.filter(r => r.result === result).reduce((s, r) => s + realizedToKRW(r), 0);
}
function totalRealizedByCategoryKRW(category) {
  return realized.filter(r => r.category === category).reduce((s, r) => s + realizedToKRW(r), 0);
}

// ---------- 투자일지 (적금·투자이체 자동 집계 + 평가손익·순이익) ----------
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

  // 투입 요약 (반반 화면 + 상세 탭 동시 갱신)
  pair('tSaveK', 'tSaveU', saveT);   pair('dSaveK', 'dSaveU', saveT);
  pair('tInvK', 'tInvU', invest);    pair('dInvK', 'dInvU', invest);
  pair('tAllK', 'tAllU', saveT + invest); pair('dAllK', 'dAllU', saveT + invest);

  // 평가손익 · 수익률 · 실현손익 · 대출이자 · 순이익 (계좌·보유 종목 기준 자동계산)
  const holdingsVal = totalHoldingsValueKRW();   // 보유 종목 평가금액 합계
  const cost = totalHoldingsCostKRW();           // 보유 종목 매입원가 합계
  const gain = totalHoldingsPnLKRW();            // 평가손익 = 평가금액 - 매입원가
  const roi = cost > 0 ? (gain / cost * 100) : 0;
  const realizedTotal = totalRealizedKRW();      // 종료(매도) 확정된 실현손익 합계
  const interest = totalInterestKRW();           // 대출 탭에서 기록한 모든 통장의 이자 합계
  const net = gain + realizedTotal - interest;   // 순이익 = 평가손익 + 실현손익 - 누적이자

  pair('pnlValK', 'pnlValU', holdingsVal);       pair('dPnlValK', 'dPnlValU', holdingsVal);
  pairSigned('pnlGainK', 'pnlGainU', gain);      pairSigned('dPnlGainK', 'dPnlGainU', gain);
  pairSigned('pnlRealK', 'pnlRealU', realizedTotal); pairSigned('dPnlRealK', 'dPnlRealU', realizedTotal);
  pair('pnlIntK', 'pnlIntU', interest);          pair('dPnlIntK', 'dPnlIntU', interest);
  pairSigned('pnlNetK', 'pnlNetU', net);         pairSigned('dPnlNetK', 'dPnlNetU', net);
  setRoi('pnlRoi', roi); setRoi('dPnlRoi', roi);

  // 적금 종류별 (상세 탭)
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

  // 투입 내역 (상세 탭)
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
      <div class="badge ${BADGE[t.type] || 'b-in'}">${esc(t.type)}</div>
      <div class="desc"><div class="m">${esc(t.memo || t.cat || '(내용 없음)')}</div><div class="c">${catLine ? esc(catLine) : '&nbsp;'}</div></div>
      <div class="amt"><div class="k num">${fmtKRW(krw)}</div><div class="u num">${t.cur === 'USD' ? '$' + t.amt.toLocaleString('en-US', {minimumFractionDigits:2}) : fmtUSD(krw)}</div></div>
    </div>`;
  }).join('');
}

// ---------- 대출(마이너스 통장) 탭 ----------
function loanCard(loan) {
  const balKRW = loanToKRW(loan, loan.balance);
  const balUsdSide = loan.cur === 'USD' ? fmtCur('USD', loan.balance) : fmtUSD(balKRW);

  const logs = interestLogs.filter(l => l.loanId === loan.id)
                            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let sumOwn = 0, sumKRW = 0;
  const rowsHtml = logs.map(l => {
    const amt = +l.amount || 0;
    sumOwn += amt;
    const krw = loanToKRW(loan, amt);
    sumKRW += krw;
    const usdSide = loan.cur === 'USD' ? fmtCur('USD', amt) : fmtUSD(krw);
    return `<div class="lrow li">
      <div class="lab">${esc(l.date)}</div>
      <div class="krw num">${fmtKRW(krw)}</div>
      <div class="usd num">${usdSide}</div>
      <button class="del" data-del-log="${l.id}" title="기록 삭제">✕</button>
    </div>`;
  }).join('') || `<div class="empty">이자 기록이 없습니다<span>아래에서 월과 금액을 입력해 추가하세요</span></div>`;

  const sumUsdSide = loan.cur === 'USD' ? fmtCur('USD', sumOwn) : fmtUSD(sumKRW);

  const meta = [];
  if (+loan.rate) meta.push(`연 ${+loan.rate}% (참고용)`);
  if (loan.start || loan.end) meta.push(`${loan.start || '?'} ~ ${loan.end || '-'}`);

  return `<section class="ledger loan-card" data-loan="${loan.id}">
    <div class="cap">
      <div class="loan-name"><b>${esc(loan.name)}</b><span class="badge b-loan">${loan.cur}</span></div>
      <div class="loan-capright">
        <span class="hint">${meta.length ? esc(meta.join(' · ')) : '&nbsp;'}</span>
        <button class="del" data-del-loan="${loan.id}" title="통장 삭제">✕</button>
      </div>
    </div>
    <div class="lrow"><div class="lab">현재 사용액</div><div class="krw num">${fmtKRW(balKRW)}</div><div class="usd num">${balUsdSide}</div></div>

    <div class="lrow li-add">
      <input type="month" id="liMonth-${loan.id}">
      <div class="amt-field"><span class="amt-prefix">${loan.cur === 'USD' ? '$' : '₩'}</span><input class="num" id="liAmt-${loan.id}" inputmode="decimal" placeholder="0"></div>
      <button class="btn ghost" type="button" data-add-interest="${loan.id}">기록 추가</button>
    </div>

    ${rowsHtml}

    <div class="lrow net"><div class="lab">이 통장 누적 이자</div><div class="krw num">${fmtKRW(sumKRW)}</div><div class="usd num">${sumUsdSide}</div></div>
  </section>`;
}

function renderLoans() {
  const box = $('#loanList');
  $('#loanCnt').textContent = loans.length ? `${loans.length}개` : '';
  box.innerHTML = loans.length
    ? loans.map(loanCard).join('')
    : `<div class="empty">등록된 마이너스 통장이 없습니다<span>위 폼에서 추가해 보세요</span></div>`;

  const totalBalanceKRW = totalLoanBalanceKRW();
  const totalIntKRW = totalInterestKRW();
  pair('loanTotalK', 'loanTotalU', totalBalanceKRW);
  pair('loanIntTotalK', 'loanIntTotalU', totalIntKRW);
  pairSigned('loanNetK', 'loanNetU', totals().total - totalBalanceKRW);
}

// ---------- 투자일지 상세: 계좌 · 보유 종목 관리 ----------
function holdingManageRow(a, h) {
  const val = holdingValue(h), cost = holdingCost(h), pnl = val - cost;
  const roi = cost > 0 ? (pnl / cost * 100) : 0;
  const cls = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '';
  const isClosing = closingHoldingId === h.id;

  return `<div class="inv-item" data-holding="${h.id}">
    <div class="inv-item-top">
      <span class="ih-name"><b>${esc(h.name)}</b><span class="ih-tag">${esc(h.category || '장기')}</span></span>
      <button class="del" data-del-holding="${h.id}" title="종목 삭제">✕</button>
    </div>
    <div class="inv-item-stats hint">평균단가 ${fmtCur(a.cur, h.avgPrice)} · 보유 ${(+h.qty || 0).toLocaleString('ko-KR')}주</div>
    <div class="inv-item-price">
      <label>현재가</label>
      <div class="amt-field">
        <span class="amt-prefix">${a.cur === 'USD' ? '$' : '₩'}</span>
        <input class="num" data-cur-price="${h.id}" value="${h.curPrice ? formatThousands(String(h.curPrice)) : ''}" inputmode="decimal" placeholder="0">
      </div>
    </div>
    <div class="inv-item-bottom">
      <span class="num">평가금액 ${fmtCur(a.cur, val)}</span>
      <span class="num ${cls}">평가손익 ${fmtCur(a.cur, pnl)} (${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%)</span>
    </div>
    <div class="inv-item-actions">
      <button class="btn ghost" type="button" data-close-open="${h.id}">${isClosing ? '종료 취소' : '종료(매도)'}</button>
    </div>
    ${isClosing ? closeForm(a, h) : ''}
  </div>`;
}

function closeForm(a, h) {
  const sym = a.cur === 'USD' ? '$' : '₩';
  const priceVal = h.curPrice || h.avgPrice || '';
  return `<div class="close-form">
    <div class="close-form-grid">
      <div class="field"><label>구분</label>
        <select id="cMode-${h.id}">
          <option value="full">전량</option>
          <option value="partial">부분</option>
        </select>
      </div>
      <div class="field"><label>매도일</label><input type="date" id="cDate-${h.id}" value="${todayStr()}"></div>
      <div class="field"><label>매도수량</label><input class="num" id="cQty-${h.id}" inputmode="decimal" value="${h.qty || ''}"></div>
      <div class="field"><label>매도단가</label>
        <div class="amt-field"><span class="amt-prefix">${sym}</span><input class="num" id="cPrice-${h.id}" inputmode="decimal" value="${priceVal ? formatThousands(String(priceVal)) : ''}"></div>
      </div>
    </div>
    <div class="setbtns">
      <button class="btn" type="button" data-close-confirm="${h.id}">종료 확정</button>
    </div>
  </div>`;
}

function acctManageCard(a) {
  const hs = holdings.filter(h => h.accountId === a.id);
  const acctValKRW = accountTotalKRW(a);
  const acctOwnTotal = (+a.cash || 0) + hs.reduce((s, h) => s + holdingValue(h), 0);
  const acctUsdSide = a.cur === 'USD' ? fmtCur('USD', acctOwnTotal) : fmtUSD(acctValKRW);

  const holdingsHtml = hs.length
    ? hs.map(h => holdingManageRow(a, h)).join('')
    : `<div class="empty">보유 종목이 없습니다</div>`;

  return `<section class="ledger acct-card" data-acct="${a.id}">
    <div class="cap">
      <div class="loan-name"><b>${esc(a.name)}</b><span class="badge b-iv">${a.cur}</span></div>
      <div class="loan-capright">
        <span class="hint">계좌 평가액 ${fmtKRW(acctValKRW)} / ${acctUsdSide}</span>
        <button class="del" data-del-acct="${a.id}" title="계좌 삭제">✕</button>
      </div>
    </div>

    <div class="lrow acct-cash-row">
      <div class="lab">예수금</div>
      <div class="amt-field">
        <span class="amt-prefix">${a.cur === 'USD' ? '$' : '₩'}</span>
        <input class="num" data-acct-cash="${a.id}" value="${a.cash ? formatThousands(String(a.cash)) : ''}" inputmode="decimal" placeholder="0">
      </div>
    </div>

    <div class="acct-holdings">${holdingsHtml}</div>

    <div class="h-add-row">
      <input placeholder="종목명" id="hName-${a.id}">
      <div class="amt-field"><span class="amt-prefix">${a.cur === 'USD' ? '$' : '₩'}</span><input class="num" placeholder="평균단가" id="hAvg-${a.id}" inputmode="decimal"></div>
      <input class="num" placeholder="수량" id="hQty-${a.id}" inputmode="decimal">
      <div class="amt-field"><span class="amt-prefix">${a.cur === 'USD' ? '$' : '₩'}</span><input class="num" placeholder="현재가" id="hCur-${a.id}" inputmode="decimal"></div>
      <select id="hCat-${a.id}"><option value="장기">장기</option><option value="단타">단타</option></select>
      <button class="btn ghost" type="button" data-add-holding="${a.id}">종목 추가</button>
    </div>
  </section>`;
}

function realizedRow(r) {
  const cls = r.result === '익절' ? 'b-in' : 'b-ex';
  return `<div class="tr rz">
    <div class="d num">${esc(r.date)}</div>
    <div class="badge ${cls}">${esc(r.result)}</div>
    <div class="desc"><div class="m">${esc(r.accountName)} · ${esc(r.holdingName)}</div><div class="c">${(+r.qty || 0).toLocaleString('ko-KR')}주 @ ${fmtCur(r.cur, r.sellPrice)} · ${esc(r.category || '')}</div></div>
    <div class="amt"><div class="k num ${r.pnl >= 0 ? 'pos' : 'neg'}">${fmtCur(r.cur, r.pnl)}</div></div>
    <button class="del" data-del-realized="${r.id}" title="기록 삭제">✕</button>
  </div>`;
}

function renderAccounts() {
  $('#acctCnt').textContent = accounts.length ? `${accounts.length}개` : '';
  $('#acctList').innerHTML = accounts.length
    ? accounts.map(acctManageCard).join('')
    : `<div class="empty">등록된 계좌가 없습니다<span>위 폼에서 추가해 보세요</span></div>`;

  const sorted = realized.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  $('#realizedCnt').textContent = sorted.length ? `${sorted.length}건` : '';
  $('#realizedList').innerHTML = sorted.length
    ? sorted.map(realizedRow).join('')
    : `<div class="empty">실현손익 기록이 없습니다<span>종목을 종료(매도)하면 여기에 기록됩니다</span></div>`;

  const winKRW = totalRealizedByResultKRW('익절');
  const loseKRW = totalRealizedByResultKRW('손절');
  const longKRW = totalRealizedByCategoryKRW('장기');
  const shortKRW = totalRealizedByCategoryKRW('단타');
  pair('rzWinK', 'rzWinU', winKRW);
  pair('rzLoseK', 'rzLoseU', loseKRW);
  pairSigned('rzLongK', 'rzLongU', longKRW);
  pairSigned('rzShortK', 'rzShortU', shortKRW);
  pairSigned('rzNetK', 'rzNetU', winKRW + loseKRW);
}

// ---------- 대시보드 '투자' 카드: 계좌별 → 종목별 아코디언 ----------
function acctAccordionBlock(a) {
  const isOpen = openAccounts.has(a.id);
  const hs = holdings.filter(h => h.accountId === a.id);
  const acctValKRW = accountTotalKRW(a);
  const acctOwnTotal = (+a.cash || 0) + hs.reduce((s, h) => s + holdingValue(h), 0);
  const acctUsdSide = a.cur === 'USD' ? fmtCur('USD', acctOwnTotal) : fmtUSD(acctValKRW);
  const cashKRW = acctToKRW(a, a.cash);
  const cashUsdSide = a.cur === 'USD' ? fmtCur('USD', a.cash) : fmtUSD(cashKRW);

  const holdingsHtml = hs.length ? hs.map(h => {
    const val = holdingValue(h), cost = holdingCost(h), pnl = val - cost;
    const roi = cost > 0 ? (pnl / cost * 100) : 0;
    const cls = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '';
    return `<div class="inv-holding">
      <span class="ih-name">${esc(h.name)}<span class="ih-tag">${esc(h.category || '장기')}</span></span>
      <span class="ih-qty num">${(+h.qty || 0).toLocaleString('ko-KR')}주</span>
      <span class="ih-val num">${fmtCur(a.cur, val)}</span>
      <span class="ih-pnl num ${cls}">${fmtCur(a.cur, pnl)} (${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%)</span>
    </div>`;
  }).join('') : `<div class="empty">보유 종목 없음</div>`;

  return `<div class="inv-acc ${isOpen ? 'open' : ''}">
    <button type="button" class="inv-acc-head" data-acc-toggle="${a.id}">
      <span class="chev">▸</span>
      <span class="inv-acc-name"><b>${esc(a.name)}</b><span class="badge b-iv">${a.cur}</span></span>
      <span class="inv-acc-val"><span class="krw num">${fmtKRW(acctValKRW)}</span><span class="usd num">${acctUsdSide}</span></span>
    </button>
    <div class="inv-acc-body" ${isOpen ? '' : 'hidden'}>
      <div class="lrow"><div class="lab">예수금</div><div class="krw num">${fmtKRW(cashKRW)}</div><div class="usd num">${cashUsdSide}</div></div>
      ${holdingsHtml}
    </div>
  </div>`;
}

function renderInvestAccordion() {
  const panel = $('#investAccordion');
  const btn = $('#investToggle');
  if (!panel || !btn) return;
  panel.innerHTML = accounts.length
    ? accounts.map(acctAccordionBlock).join('')
    : `<div class="empty">등록된 계좌가 없습니다<span>'투자일지 상세'에서 추가하세요</span></div>`;
  panel.hidden = !investOpen;
  btn.classList.toggle('open', investOpen);
}

function setRoi(id, roi) {
  const el = $('#' + id);
  if (!el) return;
  const cls = roi > 0 ? 'pos' : roi < 0 ? 'neg' : '';
  el.textContent = (roi > 0 ? '+' : '') + roi.toFixed(2) + '%';
  el.className = 'krw num ' + cls;
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

// 천 단위 콤마를 입혀서 입력칸에 값을 채움
function fillField(id, num) {
  const el = $('#' + id);
  if (el) el.value = num ? formatThousands(String(num)) : '';
}

// ⚙ 설정 패널 입력칸에 현재 setg 값을 채움 (패널이 기본 펼침이라 초기 진입 시에도 호출됨)
function populateSettingsPanel() {
  fillField('sCashKRW', setg.startCashKRW);
  fillField('sCashUSD', setg.startCashUSD);
  fillField('sSaveKRW', setg.startSaveKRW);
  fillField('sSaveUSD', setg.startSaveUSD);
  fillField('sDepositKRW', setg.startDepositKRW);
  fillField('sDepositUSD', setg.startDepositUSD);
  fillField('sGoalKRW', setg.goalKRW);
  fillField('sGoalUSD', setg.goalUSD);
}

function wire() {
  wireAmountFormatting();
  wireCurrencyPrefix('gCur', 'gAmtPrefix');
  wireCurrencyPrefix('acCur', 'acCashPrefix');
  wireCurrencyPrefix('lCur', 'lBalancePrefix');

  // 상단 탭 (대시보드 / 투자일지 상세 / 대출)
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
    else { catLab.textContent = '분류'; catIn.placeholder = '월급, 용돈…'; }
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

  // 설정 패널 (기본 펼침, ⚙로 접기/펴기)
  $('#setBtn').addEventListener('click', () => {
    const p = $('#setPanel');
    p.hidden = !p.hidden;
    if (!p.hidden) populateSettingsPanel();
  });
  $('#setCancel').addEventListener('click', () => { $('#setPanel').hidden = true; });
  $('#setSave').addEventListener('click', () => {
    setg = {
      startCashKRW: parseNum($('#sCashKRW').value), startCashUSD: parseNum($('#sCashUSD').value),
      startSaveKRW: parseNum($('#sSaveKRW').value), startSaveUSD: parseNum($('#sSaveUSD').value),
      startDepositKRW: parseNum($('#sDepositKRW').value), startDepositUSD: parseNum($('#sDepositUSD').value),
      goalKRW: parseNum($('#sGoalKRW').value), goalUSD: parseNum($('#sGoalUSD').value),
    };
    persist();
    $('#setPanel').hidden = true;
    renderAsset();
    renderInvest();
  });

  // 마이너스 통장 추가
  $('#loanForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#lName').value.trim();
    if (!name) { $('#lName').focus(); return; }
    loans.push({
      id: uid(),
      name,
      cur: $('#lCur').value,
      start: $('#lStart').value || '',
      end: $('#lEnd').value || '',
      balance: parseNum($('#lBalance').value),
      rate: parseNum($('#lRate').value),
    });
    persist();
    e.target.reset();
    renderLoans();
  });

  // 통장 목록: 이자 기록 추가/삭제, 통장 삭제 (위임)
  $('#loanList').addEventListener('click', e => {
    const addBtn = e.target.closest('[data-add-interest]');
    if (addBtn) {
      const loanId = addBtn.dataset.addInterest;
      const monthEl = $('#liMonth-' + loanId);
      const amtEl = $('#liAmt-' + loanId);
      const month = monthEl.value;
      const amt = parseNum(amtEl.value);
      if (!month) { monthEl.focus(); return; }
      if (!amt) { amtEl.focus(); return; }
      interestLogs.push({ id: uid(), loanId, date: month, amount: amt });
      persist();
      renderLoans();
      renderInvest();
      return;
    }
    const delLoanBtn = e.target.closest('[data-del-loan]');
    if (delLoanBtn) {
      const loanId = delLoanBtn.dataset.delLoan;
      loans = loans.filter(l => l.id !== loanId);
      interestLogs = interestLogs.filter(l => l.loanId !== loanId); // 통장 삭제 시 그 통장의 이자 기록도 함께 삭제
      persist();
      renderLoans();
      renderInvest();
      return;
    }
    const delLogBtn = e.target.closest('[data-del-log]');
    if (delLogBtn) {
      const logId = delLogBtn.dataset.delLog;
      interestLogs = interestLogs.filter(l => l.id !== logId);
      persist();
      renderLoans();
      renderInvest();
    }
  });

  // 대시보드 '투자' 아코디언: 전체 펼치기/접기
  $('#investToggle').addEventListener('click', () => {
    investOpen = !investOpen;
    renderInvestAccordion();
  });
  // 계좌별 개별 펼치기/접기
  $('#investAccordion').addEventListener('click', e => {
    const head = e.target.closest('[data-acc-toggle]');
    if (!head) return;
    const id = head.dataset.accToggle;
    if (openAccounts.has(id)) openAccounts.delete(id); else openAccounts.add(id);
    renderInvestAccordion();
  });

  // 계좌 추가 (투자일지 상세)
  $('#acctForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#acName').value.trim();
    if (!name) { $('#acName').focus(); return; }
    accounts.push({
      id: uid(),
      name,
      cur: $('#acCur').value,
      cash: parseNum($('#acCash').value),
    });
    persist();
    e.target.reset();
    renderAsset(); renderInvest(); renderAccounts();
  });

  // 계좌 목록: 예수금·현재가 수정 (위임)
  $('#acctList').addEventListener('change', e => {
    const cashInput = e.target.closest('[data-acct-cash]');
    if (cashInput) {
      const acct = accounts.find(a => a.id === cashInput.dataset.acctCash);
      if (acct) {
        acct.cash = parseNum(cashInput.value);
        persist();
        renderAsset(); renderInvest(); renderAccounts();
      }
      return;
    }
    const priceInput = e.target.closest('[data-cur-price]');
    if (priceInput) {
      const h = holdings.find(x => x.id === priceInput.dataset.curPrice);
      if (h) {
        h.curPrice = parseNum(priceInput.value);
        persist();
        renderAsset(); renderInvest(); renderAccounts();
      }
    }
  });

  // 계좌 목록: 종목 추가/삭제, 종료(매도), 계좌 삭제 (위임)
  $('#acctList').addEventListener('click', e => {
    const addHoldingBtn = e.target.closest('[data-add-holding]');
    if (addHoldingBtn) {
      const acctId = addHoldingBtn.dataset.addHolding;
      const nameEl = $('#hName-' + acctId);
      const name = nameEl.value.trim();
      if (!name) { nameEl.focus(); return; }
      holdings.push({
        id: uid(),
        accountId: acctId,
        name,
        avgPrice: parseNum($('#hAvg-' + acctId).value),
        qty: parseNum($('#hQty-' + acctId).value),
        curPrice: parseNum($('#hCur-' + acctId).value),
        category: $('#hCat-' + acctId).value,
      });
      persist();
      renderAsset(); renderInvest(); renderAccounts();
      return;
    }
    const delHoldingBtn = e.target.closest('[data-del-holding]');
    if (delHoldingBtn) {
      const hId = delHoldingBtn.dataset.delHolding;
      holdings = holdings.filter(h => h.id !== hId);
      if (closingHoldingId === hId) closingHoldingId = null;
      persist();
      renderAsset(); renderInvest(); renderAccounts();
      return;
    }
    const delAcctBtn = e.target.closest('[data-del-acct]');
    if (delAcctBtn) {
      const acctId = delAcctBtn.dataset.delAcct;
      accounts = accounts.filter(a => a.id !== acctId);
      holdings = holdings.filter(h => h.accountId !== acctId); // 계좌 삭제 시 보유 종목도 함께 삭제
      openAccounts.delete(acctId);
      persist();
      renderAsset(); renderInvest(); renderAccounts();
      return;
    }
    const closeOpenBtn = e.target.closest('[data-close-open]');
    if (closeOpenBtn) {
      const hId = closeOpenBtn.dataset.closeOpen;
      closingHoldingId = closingHoldingId === hId ? null : hId; // 토글
      renderAccounts();
      return;
    }
    const closeConfirmBtn = e.target.closest('[data-close-confirm]');
    if (closeConfirmBtn) {
      const hId = closeConfirmBtn.dataset.closeConfirm;
      const h = holdings.find(x => x.id === hId);
      if (!h) return;
      const acct = accounts.find(a => a.id === h.accountId);
      const mode = $('#cMode-' + hId).value;
      const date = $('#cDate-' + hId).value || todayStr();
      const qtyEl = $('#cQty-' + hId);
      let qty = mode === 'full' ? (+h.qty || 0) : parseNum(qtyEl.value);
      const price = parseNum($('#cPrice-' + hId).value);
      if (!qty || qty <= 0) { qtyEl.focus(); return; }
      if (qty > (+h.qty || 0)) qty = +h.qty || 0; // 보유수량 초과 방지

      const pnl = (price - (+h.avgPrice || 0)) * qty;
      realized.push({
        id: uid(),
        date,
        accountName: acct ? acct.name : '',
        holdingName: h.name,
        cur: acct ? acct.cur : 'KRW',
        qty, sellPrice: price, avgPrice: h.avgPrice,
        pnl,
        result: pnl >= 0 ? '익절' : '손절',
        category: h.category || '장기',
      });

      const remainQty = (+h.qty || 0) - qty;
      if (mode === 'full' || remainQty <= 0) {
        holdings = holdings.filter(x => x.id !== hId); // 전량 종료 → 보유 목록에서 제거
      } else {
        h.qty = remainQty; // 부분 종료 → 잔여 수량만 남김 (평균단가 불변)
      }

      closingHoldingId = null;
      persist();
      renderAsset(); renderInvest(); renderAccounts();
    }
  });

  // 실현손익 기록 삭제 (위임)
  $('#realizedList').addEventListener('click', e => {
    const delRealizedBtn = e.target.closest('[data-del-realized]');
    if (!delRealizedBtn) return;
    realized = realized.filter(r => r.id !== delRealizedBtn.dataset.delRealized);
    persist();
    renderInvest(); renderAccounts();
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
    loans: loans,
    interestLogs: interestLogs,
    accounts: accounts,
    holdings: holdings,
    realized: realized,
    startCashKRW: setg.startCashKRW || 0, startCashUSD: setg.startCashUSD || 0,
    startSaveKRW: setg.startSaveKRW || 0, startSaveUSD: setg.startSaveUSD || 0,
    startDepositKRW: setg.startDepositKRW || 0, startDepositUSD: setg.startDepositUSD || 0,
    goalKRW: setg.goalKRW || 0, goalUSD: setg.goalUSD || 0,
    rate: rate,
    updatedAt: localUpdatedAt,
  };
};

// 원격(Firestore) 상태를 로컬 state에 반영 후 다시 그리기
// 기존에 저장된 대출 자동계산 필드(loanPrincipal 등)나 투자 시작값/평가금액 손입력
// 필드(startInvestKRW·investValue 등)가 남아있어도 그냥 읽지 않고 무시하므로
// 오류 없이 새 구조(loans/interestLogs, accounts/holdings/realized)로 넘어간다.
//
// 원격 데이터의 updatedAt이 이 기기의 마지막 편집 시각보다 더 오래됐으면 통째로 무시한다.
// (예: 입력 직후 0.4초 디바운스가 서버에 반영되기 전에 새로고침/재로그인하면, 서버에는
//  아직 '이전' 데이터만 있는 상태 — 이걸 받아서 방금 입력한 로컬 데이터를 덮어쓰는
//  사고를 막는다. 서버 쓰기가 완료되면 같은/더 새 타임스탬프로 다시 도착해 정상 반영된다.)
window.gbReceive = function gbReceive(remote) {
  if (!remote || typeof remote !== 'object') return;
  const remoteUpdatedAt = +remote.updatedAt || 0;
  if (remoteUpdatedAt < localUpdatedAt) return;
  localUpdatedAt = remoteUpdatedAt;
  txs = Array.isArray(remote.items) ? remote.items : [];
  loans = Array.isArray(remote.loans) ? remote.loans : [];
  interestLogs = Array.isArray(remote.interestLogs) ? remote.interestLogs : [];
  accounts = Array.isArray(remote.accounts) ? remote.accounts : [];
  holdings = Array.isArray(remote.holdings) ? remote.holdings : [];
  realized = Array.isArray(remote.realized) ? remote.realized : [];
  setg = {
    startCashKRW: +remote.startCashKRW || 0, startCashUSD: +remote.startCashUSD || 0,
    startSaveKRW: +remote.startSaveKRW || 0, startSaveUSD: +remote.startSaveUSD || 0,
    startDepositKRW: +remote.startDepositKRW || 0, startDepositUSD: +remote.startDepositUSD || 0,
    goalKRW: +remote.goalKRW || 0, goalUSD: +remote.goalUSD || 0,
  };
  rate = +remote.rate || rate;
  save(LS.tx, txs);
  save(LS.set, setg);
  save(LS.rate, rate);
  save(LS.loans, loans);
  save(LS.ilogs, interestLogs);
  save(LS.accounts, accounts);
  save(LS.holdings, holdings);
  save(LS.realized, realized);
  save(LS.updatedAt, localUpdatedAt);
  const rateIn = $('#rate');
  if (rateIn) rateIn.value = rate;
  buildPeriodSelects();
  renderAll();
  if (!$('#setPanel').hidden) populateSettingsPanel(); // 패널이 열려있으면 값도 갱신
};

// ================= 시작 =================
function init() {
  setDefaultDate();
  buildPeriodSelects();
  wire();
  populateSettingsPanel(); // 설정 패널이 기본 펼침이므로 처음부터 값 채움
  renderAll();
  fetchRate(); // 백그라운드 자동 조회
}
init();
