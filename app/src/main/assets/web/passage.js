// 生词的 AI 短文复习（同 iPad 的 VocabPassageSession、VocabPassageAI、VocabPassage）：
// 从背过的词里挑 12 个，请 AI 写一篇短文；写出标出的词在文中的意思，AI 逐词批改，按结论建议自评，确认后记一条结果等 iPad 来取。
// 批改后可以在短文里选词加入生词本（同 iPad 在 AI 短文里划词）：手机请 AI 查释义，记一条 vocab_add 等 iPad 来取
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
    /** 按空行分段，去掉段首段尾的空白、空段不要；words 是生词在段里的位置（UTF-16），同 VocabPassage.paragraphs */
    paragraphs() {
      const out = [{ text: '', words: [] }];
      for (const x of segments) {
        if (x.id) {
          const cur = out[out.length - 1];
          cur.words.push({ id: x.id, location: cur.text.length, length: x.surface.length });
          cur.text += x.surface;
        } else {
          x.text.split('\n\n').forEach((part, i) => {
            if (i > 0) out.push({ text: '', words: [] });
            out[out.length - 1].text += part;
          });
        }
      }
      return out.map(par => {
        const shift = par.text.length - par.text.replace(/^\s+/, '').length;
        const text = par.text.trim();
        return { text, words: par.words.map(w => ({ id: w.id, location: w.location - shift, length: w.length })) };
      }).filter(par => par.text);
    },
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
  closeWordSheet();
  // id 也是这篇短文里加入的生词的 passageID（iPad 上 VocabEntry 的 key 用它）
  s = { id: uuid(), words: picked.map((entry, i) => ({ id: i + 1, entry })), usage: [], answers: {}, grades: null, ratings: {},
        createdAt: 0, passage: null, phase: 'generating', added: {} };
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

/** 选词只在批改之后（同 iPad：作答时不能查） */
const canSelect = () => s && (s.phase === 'rating' || s.phase === 'confirmed');

/** 一段：考的词按批改结论标色、带序号；在这篇短文里加入生词本的词标黄、点了看释义 */
function paragraphHTML(par, index) {
  const p = s.passage;
  const n = par.text.length;
  const mark = new Array(n).fill(0), added = new Array(n).fill(null);
  for (const w of par.words) for (let i = w.location; i < w.location + w.length && i < n; i++) mark[i] = w.id;
  for (const a of Object.values(s.added)) {
    if (a.paragraph !== par.text) continue;
    for (let i = a.location; i < a.location + a.length && i < n; i++) added[i] = a.key;
  }
  let html = '';
  for (let i = 0; i < n;) {
    let j = i;
    while (j < n && mark[j] === mark[i] && added[j] === added[i]) j++;
    let piece = esc(par.text.slice(i, j));
    if (added[i]) piece = `<span class="added" data-key="${esc(added[i])}">${piece}</span>`;
    if (mark[i]) {
      let cls = 'word';
      const g = s.grades && s.grades[mark[i]];
      if (g) cls += ' ' + ({ correct: 'right', partial: 'partial', wrong: 'wrong' }[g.result]);
      piece = `<span class="${cls}">${piece}</span>`;
      if (j >= n || mark[j] !== mark[i]) piece += `<sup class="num">${p.number(mark[i])}</sup>`;
    }
    html += piece;
    i = j;
  }
  return `<p class="para" data-par="${index}">${html}</p>`;
}

function passageHTML() {
  const p = s.passage;
  const tip = canSelect() ? '<p class="muted">长按选词可以加入生词本</p>' : '';
  return `<div class="card passage"><b>${esc(p.title)}</b>${p.paragraphs().map(paragraphHTML).join('')}${tip}</div>`;
}

function render() {
  app.innerHTML = '';
  const bar = el('<div class="top"><span class="grow">AI 短文复习</span></div>');
  const end = el('<button class="link">结束</button>');
  end.onclick = () => call('close');
  bar.appendChild(end);
  app.appendChild(bar);
  const passage = el(passageHTML());
  passage.onclick = e => {
    const a = e.target.closest('.added');
    if (a && s.added[a.dataset.key]) showWordSheet(a.dataset.key);
  };
  app.appendChild(passage);
  hideSelectBar();
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
    id: s.id, type: 'passage', title: p.title, passage: p.text, createdAt: s.createdAt, confirmedAt: Date.now(),
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

// ---- 选词加入生词本（同 iPad 的 WordLookupSession，只查词，不翻译长句）----

/** 同 VocabSelection.stableHash：UTF-8 字节的 FNV-1a（32 位） */
function stableHash(str) {
  let h = 2166136261;
  for (const b of new TextEncoder().encode(str)) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h;
}

/** 选中位置所在的句子（iPad 用 NLTokenizer 重新取；这里只给 AI 查意思用） */
function sentenceAround(text, location) {
  if (window.Intl && Intl.Segmenter) {
    for (const seg of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)) {
      if (location < seg.index + seg.segment.length) return seg.segment.trim();
    }
  }
  const start = Math.max(text.lastIndexOf('. ', location), text.lastIndexOf('? ', location), text.lastIndexOf('! ', location));
  const ends = ['. ', '? ', '! '].map(t => text.indexOf(t, location)).filter(i => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(start < 0 ? 0 : start + 2, end).trim();
}

/** 解析「音标 / 意思 / 原形 / 其他」几行，同 VocabAI.Meaning */
function parseMeaning(text) {
  const m = { meaning: null, form: null, note: null, phonetic: null };
  const fields = { '音标：': 'phonetic', '意思：': 'meaning', '原形：': 'form', '其他：': 'note', '补充：': 'note' };
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    const prefix = Object.keys(fields).find(f => line.startsWith(f));
    if (prefix) {
      const v = line.slice(prefix.length).trim();
      m[fields[prefix]] = v && v !== '无' ? v : null;
    } else if (m.meaning === null && line) {
      m.meaning = line;
    }
  }
  return m;
}

/** 选区一端在段落文字里的位置：数前面的文字，序号（sup）不算 */
function offsetIn(par, node, offset) {
  const r = document.createRange();
  r.setStart(par, 0);
  r.setEnd(node, offset);
  const before = r.cloneContents();
  before.querySelectorAll('sup').forEach(x => x.remove());
  return before.textContent.length;
}

/** 当前选区：在同一段里、不太长才算；去掉两头的空白和标点 */
function currentSelection() {
  if (!canSelect()) return null;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const parOf = n => (n.nodeType === Node.TEXT_NODE ? n.parentElement : n).closest('p.para');
  const par = parOf(range.startContainer);
  if (!par || par !== parOf(range.endContainer)) return null;
  const info = s.passage.paragraphs()[+par.dataset.par];
  let a = offsetIn(par, range.startContainer, range.startOffset), b = offsetIn(par, range.endContainer, range.endOffset);
  if (!info) return null;
  const strip = /[\s.,;:!?"'“”‘’()\[\]—–-]/;
  while (a < b && strip.test(info.text[a])) a++;
  while (b > a && strip.test(info.text[b - 1])) b--;
  const word = info.text.slice(a, b);
  if (!word || word.length > 60 || word.split(/\s+/).length > 6) return null;
  return { paragraph: info.text, location: a, length: b - a, word };
}

let selectBar = null, selectTimer = null;

function hideSelectBar() {
  if (selectBar) { selectBar.remove(); selectBar = null; }
}

document.addEventListener('selectionchange', () => {
  clearTimeout(selectTimer);
  selectTimer = setTimeout(() => {
    const sel = currentSelection();
    hideSelectBar();
    if (!sel) return;
    const key = ['aipassage', s.id, stableHash(sel.paragraph), sel.location].join('|');
    selectBar = el('<div class="selbar"><button class="btn"></button></div>');
    const b = selectBar.querySelector('button');
    b.textContent = s.added[key] ? '「' + sel.word + '」已在生词本' : '加入生词本：' + sel.word;
    b.onclick = () => {
      window.getSelection().removeAllRanges();
      hideSelectBar();
      if (!s.added[key]) addWord(key, sel);
      showWordSheet(key);
    };
    document.body.appendChild(selectBar);
  }, 250);
});

function addWord(key, sel) {
  const entry = {
    key, passageID: s.id, title: s.passage.title, paragraph: sel.paragraph, location: sel.location, length: sel.length,
    word: sel.word, sentence: sentenceAround(sel.paragraph, sel.location), at: Date.now(),
  };
  call('addWord', { entry });
  s.added[key] = Object.assign({}, entry, { looking: true });
  render();
  callAsync('lookup', { word: entry.word, sentence: entry.sentence }).then(text => {
    const m = parseMeaning(text);
    const a = s.added[key];
    if (!a) return;
    Object.assign(a, m, { looking: false });
    const { looking, error, ...saved } = a;
    call('addWord', { entry: saved, replaceOnly: true });
    refreshWordSheet(key);
  }).catch(err => {
    const a = s.added[key];
    if (!a) return;
    a.looking = false;
    a.error = err.message;
    refreshWordSheet(key);
  });
}

function removeWord(key) {
  const a = s.added[key];
  if (!a) return;
  call('removeWord', { key, word: a.word });
  delete s.added[key];
  closeWordSheet();
  render();
}

let wordSheet = null;

function closeWordSheet() {
  if (wordSheet) { wordSheet.el.remove(); wordSheet = null; }
}

function refreshWordSheet(key) {
  if (wordSheet && wordSheet.key === key) showWordSheet(key);
}

/** 生词的释义：AI 查完前显示「正在查」；可以移出生词本 */
function showWordSheet(key) {
  closeWordSheet();
  const a = s.added[key];
  if (!a) return;
  const m = el('<div class="menu"><div class="sheet"></div></div>');
  const sheet = m.querySelector('.sheet');
  sheet.insertAdjacentHTML('beforeend', `<div><span class="big">${esc(a.word)}</span> <span class="muted">${esc(a.phonetic || '')}</span></div>
    <p class="muted">已加入生词本，下次和 iPad 同步时交给 iPad</p>`);
  if (a.looking) sheet.insertAdjacentHTML('beforeend', '<p class="muted">AI 正在查意思…</p>');
  else if (a.error) sheet.insertAdjacentHTML('beforeend', `<p style="color:var(--orange)">没查到意思：${esc(a.error)}。可以在 iPad 的生词本里重新生成释义。</p>`);
  if (a.meaning) sheet.insertAdjacentHTML('beforeend', `<p>${esc(a.meaning)}</p>`);
  if (a.form) sheet.insertAdjacentHTML('beforeend', `<p style="color:var(--orange)">原形：${esc(a.form)}</p>`);
  if (a.note) sheet.insertAdjacentHTML('beforeend', `<p class="muted">其他意思：${esc(a.note)}</p>`);
  sheet.insertAdjacentHTML('beforeend', `<p class="muted">${esc(a.sentence)}</p>`);
  const row = el('<div class="row"></div>');
  const speak = el('<button class="btn plain">朗读</button>');
  speak.onclick = () => call('speak', { text: a.word });
  const remove = el('<button class="btn plain">移出生词本</button>');
  remove.onclick = () => removeWord(key);
  const ok = el('<button class="btn">好</button>');
  ok.onclick = closeWordSheet;
  row.append(speak, remove, ok);
  sheet.appendChild(row);
  m.onclick = e => { if (e.target === m) closeWordSheet(); };
  document.body.appendChild(m);
  wordSheet = { key, el: m };
}

window.lpBack = () => {
  if (wordSheet) { closeWordSheet(); return true; }
  return false;
};
start();
