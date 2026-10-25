// 计算测速（同 iPad 的 FactDrillView / FactDrillSession，规则照搬 ArithmeticFacts）：
// 进位加法、退位减法、表内除法、带余除法各抽 perKind 题混在一起出，上次答错、答得慢、没测过的多抽。
// 屏幕键盘作答（带「余」键），从出题到点「确定」计时（只算亮屏时间），另记按第一个键的时间；
// 答错显示正确答案，点「继续」再做，这道题在本轮最后再出一次（不计入成绩）。
// 一轮结束（或中途退出）时记一条结果，等 iPad 来取（PROTOCOL.md 的 fact）
'use strict';

const app = document.getElementById('app');

// ---- 规则（同 ArithmeticFacts）----

const KINDS = ['add', 'sub', 'div', 'rem'];
const LABEL = { add: '进位加法', sub: '退位减法', div: '表内除法', rem: '带余除法' };
const fluentSeconds = kind => kind === 'rem' ? 3 : 2;

function range(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; }

/** 某一类的全部事实 {kind, a, b} */
function facts(kind) {
  const out = [];
  if (kind === 'add') for (const a of range(2, 9)) for (const b of range(2, 9)) { if (a + b >= 11) out.push({ kind, a, b }); }
  if (kind === 'sub') for (const a of range(11, 18)) for (const b of range(2, 9)) { if (a - b >= 2 && a - b <= 9) out.push({ kind, a, b }); }
  if (kind === 'div') for (const d of range(2, 9)) for (const q of range(2, 9)) out.push({ kind, a: d * q, b: d });
  if (kind === 'rem') for (const d of range(2, 9)) for (const q of range(1, 9)) out.push({ kind, a: d, b: q });
  return out;
}

const keyOf = f => f.kind + ':' + f.a + ':' + f.b;

/** 出题：{fact, left, right, symbol, answer: {value, remainder}}；带余除法从倍数区间里随机挑余数 */
function question(f) {
  switch (f.kind) {
    case 'add': return { fact: f, left: f.a, right: f.b, symbol: '+', answer: { value: f.a + f.b, remainder: null } };
    case 'sub': return { fact: f, left: f.a, right: f.b, symbol: '−', answer: { value: f.a - f.b, remainder: null } };
    case 'div': return { fact: f, left: f.a, right: f.b, symbol: '÷', answer: { value: f.a / f.b, remainder: null } };
    default: {
      const r = 1 + Math.floor(Math.random() * (f.a - 1));
      return { fact: f, left: f.a * f.b + r, right: f.a, symbol: '÷', answer: { value: f.b, remainder: r } };
    }
  }
}

const promptOf = q => q.left + ' ' + q.symbol + ' ' + q.right;
const answerText = a => a.remainder == null ? String(a.value) : a.value + '余' + a.remainder;

/** 解析键盘输入「6」「7余1」；不完整时为 null */
function parse(s) {
  const parts = s.split('余');
  if (parts.length > 2 || !/^\d+$/.test(parts[0])) return null;
  if (parts.length === 1) return { value: +parts[0], remainder: null };
  return /^\d+$/.test(parts[1]) ? { value: +parts[0], remainder: +parts[1] } : null;
}

/** 余数为 0 和不写余数算一样 */
function isCorrect(q, given) {
  return !!given && given.value === q.answer.value && (given.remainder || 0) === (q.answer.remainder || 0);
}

/** 抽题的权重：没测过 2，上次答错 4，答对的按超出熟练线的程度 1…3 */
function weight(stat, kind) {
  if (!stat) return 2;
  if (!stat.correct) return 4;
  return 1 + Math.min(Math.max(stat.seconds / fluentSeconds(kind) - 1, 0), 2);
}

/** 每类各 perKind 题，同一类不重复，按权重不放回地抽（Efraimidis–Spirakis），打乱后混在一起出 */
function dailyTest(perKind, stats) {
  let picked = [];
  for (const kind of KINDS) {
    const keyed = facts(kind).map(f => [Math.pow(Math.random() || 1e-12, 1 / weight(stats[keyOf(f)], kind)), f]);
    keyed.sort((x, y) => y[0] - x[0]);
    picked = picked.concat(keyed.slice(0, perKind).map(x => x[1]));
  }
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked.map(question);
}

function summary(results) {
  const firsts = results.filter(r => !r.retry);
  const right = firsts.filter(r => r.correct);
  return {
    count: firsts.length, correct: right.length,
    fluent: firsts.filter(r => r.correct && r.seconds <= fluentSeconds(r.kind)).length,
    average: right.length ? right.reduce((s, r) => s + r.seconds, 0) / right.length : null,
  };
}

// ---- 一轮 ----

let setup, items = [], index = 0, input = '', phase = 'answering', last = null;
let results = [], createdAt = 0, saved = false;
const clock = new Clock();
let thinkSeconds = null;

function load() {
  setup = call('setup');
  start();
}

function start() {
  items = dailyTest(setup.perKind || 10, setup.stats || {}).map(q => ({ q, retry: false }));
  index = 0; results = []; last = null; saved = false; phase = 'answering';
  createdAt = Date.now();
  showCurrent();
}

function showCurrent() {
  input = ''; thinkSeconds = null;
  clock.reset(); clock.start();
  render();
}

function press(key) {
  if (phase !== 'answering') return;
  if (key === 'del') { input = input.slice(0, -1); render(); return; }
  if (key === '余' && (!input || input.includes('余'))) return;
  if (key !== '余' && input.length >= 5) return;
  if (thinkSeconds === null) thinkSeconds = clock.seconds;
  input += key;
  render();
}

function submit() {
  const given = parse(input);
  if (phase !== 'answering' || !given) return;
  const { q, retry } = items[index];
  const correct = isCorrect(q, given);
  const r = {
    key: keyOf(q.fact), kind: q.fact.kind, prompt: promptOf(q), answer: answerText(q.answer), given: input,
    correct, seconds: clock.seconds, thinkSeconds, retry, answeredAt: Date.now(),
  };
  clock.stop();
  results.push(r);
  last = r;
  if (correct) { next(); return; }
  if (!retry) items.push({ q, retry: true });
  phase = 'wrong';
  render();
}

function next() {
  index++;
  if (index < items.length) { phase = 'answering'; showCurrent(); return; }
  phase = 'finished';
  save(true);
  render();
}

/** 一轮记一条；中途退出时只记已答的，finishedAt 为 null */
function save(finished) {
  if (saved || !results.length) return;
  saved = true;
  call('save', { id: uuid(), createdAt, finishedAt: finished ? Date.now() : null, results });
}

function close() { save(false); call('close'); }

// ---- 界面 ----

function render() {
  app.innerHTML = '';
  if (phase === 'finished') { renderResults(); return; }
  const bar = el(`<div class="top"><span class="grow">计算测速 ${Math.min(index + 1, items.length)} / ${items.length}</span></div>`);
  const end = el('<button class="link">结束</button>');
  end.onclick = close;
  bar.appendChild(end);
  app.appendChild(bar);

  const lastLine = el('<div class="fact-last"></div>');
  if (phase === 'answering' && last && last.correct) {
    const fluent = last.seconds <= fluentSeconds(last.kind);
    lastLine.innerHTML = `<span style="color:var(${fluent ? '--green' : '--orange'})">✓ ${esc(last.prompt)} = ${esc(last.answer)}　${last.seconds.toFixed(1)} 秒</span>`;
  }
  app.appendChild(lastLine);

  const { q, retry } = items[index];
  if (retry) app.appendChild(el('<div class="center" style="color:var(--orange)">刚才答错的题，再做一次</div>'));
  const shown = phase === 'wrong' ? `<span class="given">${esc(last.given)}</span>`
    : input ? esc(input) : '<span class="q">?</span>';
  app.appendChild(el(`<div class="fact-prompt">${esc(promptOf(q))} = ${shown}</div>`));

  if (phase === 'wrong') {
    app.appendChild(el(`<div class="fact-answer">${esc(last.prompt)} = ${esc(last.answer)}</div>`));
    app.appendChild(el('<p class="center muted">把整个式子念一遍，再继续</p>'));
    const row = el('<div class="row"><button class="btn">继续</button></div>');
    row.querySelector('button').onclick = () => { phase = 'answering'; next(); };
    app.appendChild(row);
    return;
  }

  const pad = el('<div class="keypad"></div>');
  for (const k of ['7', '8', '9', '4', '5', '6', '1', '2', '3', '余', '0', 'del']) {
    const b = el(`<button>${k === 'del' ? '⌫' : k}</button>`);
    // 按下就算（不等抬起），计时更准
    b.addEventListener('pointerdown', e => { e.preventDefault(); press(k); });
    pad.appendChild(b);
  }
  const ok = el('<button class="ok">确定</button>');
  ok.disabled = !parse(input);
  ok.addEventListener('pointerdown', e => { e.preventDefault(); submit(); });
  pad.appendChild(ok);
  app.appendChild(pad);
}

function renderResults() {
  const s = summary(results);
  const card = el('<div class="card"></div>');
  card.insertAdjacentHTML('beforeend', `<div class="big">共 ${s.count} 题 · 对 ${s.correct} · 熟 ${s.fluent}</div>`);
  if (s.average != null) card.insertAdjacentHTML('beforeend', `<p>答对的平均 ${s.average.toFixed(1)} 秒</p>`);
  const table = el('<table class="fact-table"></table>');
  for (const kind of KINDS) {
    const k = summary(results.filter(r => r.kind === kind));
    if (!k.count) continue;
    table.insertAdjacentHTML('beforeend', `<tr><td><b>${LABEL[kind]}</b></td><td>对 ${k.correct}/${k.count}</td>`
      + `<td>${k.average == null ? '—' : '平均 ' + k.average.toFixed(1) + ' 秒'}</td><td class="muted">熟 ${k.fluent}</td></tr>`);
  }
  card.appendChild(table);
  app.appendChild(card);

  const firsts = results.filter(r => !r.retry);
  const wrong = firsts.filter(r => !r.correct);
  if (wrong.length) {
    const w = el('<div class="card"><b>答错的</b></div>');
    for (const r of wrong) w.insertAdjacentHTML('beforeend', `<div style="color:var(--red)">${esc(r.prompt)} = ${esc(r.answer)}（写了 ${esc(r.given)}）</div>`);
    app.appendChild(w);
  }
  const slow = firsts.filter(r => r.correct && r.seconds > fluentSeconds(r.kind)).sort((a, b) => b.seconds - a.seconds);
  if (slow.length) {
    const w = el('<div class="card"><b>答对但慢的（超过熟练线）</b></div>');
    for (const r of slow.slice(0, 10)) w.insertAdjacentHTML('beforeend', `<div style="color:var(--orange)">${esc(r.prompt)} = ${esc(r.answer)}　${r.seconds.toFixed(1)} 秒</div>`);
    app.appendChild(w);
  }
  const row = el('<div class="row"><button class="btn plain">再测一轮</button><button class="btn">完成</button></div>');
  row.children[0].onclick = () => { setup = call('setup'); start(); };
  row.children[1].onclick = () => call('close');
  app.appendChild(row);
}

// 返回键：先把已答的存下来，再关掉
window.lpBack = () => { save(phase === 'finished'); return false; };
try { load(); } catch (err) { app.innerHTML = '<div class="card">出错了：' + esc(err.message) + '</div>'; }
