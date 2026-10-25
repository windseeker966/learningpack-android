// 生词的 AI 短文复习（同 iPad 的 VocabPassageSession、VocabPassageAI、VocabPassage）：
// 从背过的词里挑 12 个，请 AI 写一篇短文；写出标出的词在文中的意思，AI 逐词批改，按结论建议自评，确认后记一条结果等 iPad 来取
'use strict';

const app = document.getElementById('app');
let s = null;

function passageUser(words) {
  return '【生词】\n' + words.map(w => {
    let line = `${w.id}. ${w.entry.word}`;
    if (w.entry.meaning) line += ` —— 意思：${w.entry.meaning}`;
    return line + `；原句：${w.entry.sentence}`;
  }).join('\n');
}

/** 取出回答里的 JSON 对象（容忍前后多余的文字或代码块标记） */
function jsonObject(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('AI 的回答不是预期的格式，请重试。');
  try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { throw new Error('AI 的回答不是预期的格式，请重试。'); }
}

/** 短文：{{编号|文中形式}} 标出生词；编号不对或重复的当普通文字（同 VocabPassage） */
function parsePassage(title, text, validIDs) {
  const segments = [], used = [];
  const re = /\{\{\s*(\d+)\s*\|([^{}]+)\}\}/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) });
    const id = +m[1], surface = m[2].trim();
    if (validIDs.includes(id) && !used.includes(id)) { segments.push({ id, surface }); used.push(id); }
    else segments.push({ text: surface });
    last = re.lastIndex;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return {
    title, text, segments, used,
    plain() { return segments.map(x => x.id ? x.surface : x.text).join(''); },
    surface(id) { const x = segments.find(y => y.id === id); return x ? x.surface : null; },
    number(id) { return used.indexOf(id) + 1; },
  };
}

function gradingUser(p, items) {
  let user = `【短文】${p.title}\n${p.plain()}\n\n【学生作答】\n`;
  for (const item of items) {
    const surface = p.surface(item.id) || item.entry.word;
    let line = `${item.id}. ${surface}`;
    if (surface.toLowerCase() !== item.entry.word.toLowerCase()) line += `（生词本里是 ${item.entry.word}）`;
    if (item.entry.meaning) line += `，生词本释义：${item.entry.meaning}`;
    const answer = (item.answer || '').trim();
    user += line + `；学生写：${answer || '（没写）'}\n`;
  }
  return user;
}

function parseGrades(text) {
  const raw = jsonObject(text);
  const grades = {};
  for (const item of raw.results || []) {
    const r = String(item.result || '').trim();
    if (!['correct', 'partial', 'wrong'].includes(r)) continue;
    const note = (item.note || '').trim();
    grades[item.id] = { result: r, note: note || null };
  }
  if (!Object.keys(grades).length) throw new Error('AI 的回答不是预期的格式，请重试。');
  return grades;
}

const SUGGESTED = { correct: 3, partial: 2, wrong: 1 };
const RATINGS = [[1, '不认识', 'red'], [2, '模糊', 'orange'], [3, '认识', 'green'], [4, '太简单', 'blue']];

function message(html, retry) {
  app.innerHTML = '';
  app.appendChild(el('<div class="card">' + html + '</div>'));
  const row = el('<div class="row"></div>');
  if (retry) {
    const b = el('<button class="btn">重试</button>');
    b.onclick = retry;
    row.appendChild(b);
  }
  const end = el(`<button class="btn ${retry ? 'plain' : ''}">结束</button>`);
  end.onclick = () => call('close');
  row.appendChild(end);
  app.appendChild(row);
}

async function start() {
  if (!call('configured')) return message('还没有设置 AI：在首页右上角「设置 › AI 短文复习」里填写 API Key。');
  const picked = call('pick');
  if (!picked.length) return message('背过的词不够 3 个，或者最近一小时的 AI 短文已经用过了。先去背单词吧。');
  s = { words: picked.map((entry, i) => ({ id: i + 1, entry })), usage: [], answers: {}, grades: null, ratings: {},
        createdAt: 0, passage: null, phase: 'generating' };
  generate();
}

async function generate() {
  message('<p>AI 正在用 ' + s.words.length + ' 个背过的词写短文…</p>');
  try {
    const r = await callAsync('ai', { kind: 'passage', user: passageUser(s.words) });
    const obj = jsonObject(r.text);
    const p = parsePassage(String(obj.title || ''), String(obj.passage || ''), s.words.map(w => w.id));
    if (p.used.length * 2 < s.words.length) throw new Error('AI 只用上了一小部分词，请重试。');
    s.passage = p;
    s.usage.push(r.usage);
    s.createdAt = Date.now();
    s.phase = 'answering';
    call('remember', { keys: p.used.map(id => entry(id).key) });
    render();
  } catch (e) {
    message('<p>没写出来：' + esc(e.message) + '</p>', generate);
  }
}

function entry(id) { return s.words.find(w => w.id === id).entry; }

function passageHTML() {
  const p = s.passage;
  let html = p.segments.map(x => {
    if (!x.id) return esc(x.text);
    let cls = 'word';
    if (s.grades && s.grades[x.id]) cls += ' ' + ({ correct: 'right', partial: 'partial', wrong: 'wrong' }[s.grades[x.id].result]);
    return `<span class="${cls}">${esc(x.surface)}</span><sup class="num">${p.number(x.id)}</sup>`;
  }).join('');
  html = html.split(/\n\s*\n/).map(par => '<p>' + par.replace(/\n/g, '<br>') + '</p>').join('');
  return `<div class="card"><b>${esc(p.title)}</b>${html}</div>`;
}

function render() {
  app.innerHTML = '';
  const bar = el('<div class="top"><span class="grow">AI 短文复习</span></div>');
  const end = el('<button class="link">结束</button>');
  end.onclick = () => call('close');
  bar.appendChild(end);
  app.appendChild(bar);
  app.appendChild(el(passageHTML()));
  const p = s.passage;

  if (s.phase === 'answering' || s.phase === 'grading') {
    const card = el('<div class="card"><b>写出标出的词在文中的意思</b></div>');
    for (const id of p.used) {
      const row = el(`<div class="part"><div>${p.number(id)}. <b>${esc(p.surface(id))}</b></div></div>`);
      const input = el('<input type="text" placeholder="在文中的意思">');
      input.value = s.answers[id] || '';
      input.oninput = () => { s.answers[id] = input.value; };
      row.appendChild(input);
      card.appendChild(row);
    }
    app.appendChild(card);
    const row = el('<div class="row"></div>');
    const submit = el(`<button class="btn">${s.phase === 'grading' ? 'AI 正在批改…' : '提交，请 AI 批改'}</button>`);
    submit.disabled = s.phase === 'grading';
    submit.onclick = grade;
    row.appendChild(submit);
    app.appendChild(row);
    return;
  }

  // 自评
  const card = el('<div class="card"></div>');
  if (s.gradeError) card.insertAdjacentHTML('beforeend', `<p style="color:var(--orange)">AI 批改失败：${esc(s.gradeError)}。请自己对照释义自评。</p>`);
  for (const id of p.used) {
    const e = entry(id), g = s.grades && s.grades[id];
    const verdict = g ? { correct: '✓ 对', partial: '△ 部分对', wrong: '✗ 错' }[g.result] : '';
    const box = el(`<div class="part">
      <div>${p.number(id)}. <b>${esc(p.surface(id))}</b> <span>${verdict}</span></div>
      <div class="muted">你写：${esc((s.answers[id] || '').trim() || '（没写）')}</div>
      ${g && g.note ? `<div>${esc(g.note)}</div>` : ''}
      <div class="muted">生词本：${esc(e.word)} ${esc(e.phonetic || '')}　${esc(e.meaning || '')}</div></div>`);
    const speak = el('<button class="link">朗读</button>');
    speak.onclick = () => call('speak', { text: e.word });
    box.appendChild(speak);
    const row = el('<div class="blankrow"></div>');
    for (const [rating, label] of RATINGS) {
      const b = el(`<button class="pill ${s.ratings[id] === rating ? 'on' : ''}">${label}</button>`);
      b.onclick = () => { if (s.phase === 'rating') { s.ratings[id] = rating; render(); } };
      row.appendChild(b);
    }
    box.appendChild(row);
    card.appendChild(box);
  }
  app.appendChild(card);
  const row = el('<div class="row"></div>');
  if (s.phase === 'rating') {
    const confirm = el('<button class="btn">确认，计入复习</button>');
    confirm.disabled = !p.used.every(id => s.ratings[id]);
    confirm.onclick = save;
    row.appendChild(confirm);
  } else {
    const again = el('<button class="btn">再来一篇</button>');
    again.onclick = start;
    row.appendChild(again);
    const close = el('<button class="btn plain">结束</button>');
    close.onclick = () => call('close');
    row.appendChild(close);
  }
  app.appendChild(row);
}

async function grade() {
  s.phase = 'grading';
  render();
  const p = s.passage;
  const items = p.used.map(id => ({ id, entry: entry(id), answer: s.answers[id] || '' }));
  try {
    const r = await callAsync('ai', { kind: 'grade', user: gradingUser(p, items) });
    s.grades = parseGrades(r.text);
    s.usage.push(r.usage);
    s.gradeError = null;
  } catch (e) {
    s.grades = null;
    s.gradeError = e.message;
  }
  for (const id of p.used) {
    const g = s.grades && s.grades[id];
    if (g) s.ratings[id] = SUGGESTED[g.result];
    else if (s.grades && !(s.answers[id] || '').trim()) s.ratings[id] = 1;
  }
  s.phase = 'rating';
  render();
}

function save() {
  const p = s.passage;
  const result = {
    id: uuid(), type: 'passage', title: p.title, passage: p.text, createdAt: s.createdAt, confirmedAt: Date.now(),
    items: p.used.map(id => {
      const g = s.grades && s.grades[id];
      return { id, entryKey: entry(id).key, word: entry(id).word, answer: (s.answers[id] || '').trim(),
               result: g ? g.result : null, note: g ? g.note : null, rating: s.ratings[id] };
    }),
    usage: s.usage,
  };
  call('confirm', { result });
  s.phase = 'confirmed';
  render();
}

window.lpBack = () => false;
start();
