// 做今天的复习题：一组 5 道（也可以一组 10 道），选择题和填空题。判分、打乱选项、填空比对都同 iPad（Grading、OptionOrder、BlankMatcher）；
// 结果交给 Java 存着，等 iPad 来取（PROTOCOL.md 的 choice / blank）。iPad 会用当前题目重新判分。
'use strict';

const app = document.getElementById('app');
const BLOCK = 5;
// 一大组：组末「再来 10 道」，或首页「做一大组」进来
const BIG_BLOCK = 10;
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const ROMAN_KEYS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ'];
const roman = k => ROMAN_KEYS.indexOf(k) >= 0 ? ROMAN[ROMAN_KEYS.indexOf(k)] : k;
const romanOrder = k => ROMAN_KEYS.indexOf(k) >= 0 ? ROMAN_KEYS.indexOf(k) : ROMAN_KEYS.length;

// 选择题的错误类型（同 iPad 的 ErrorType；「蒙的」只在把握程度里选）
const ERROR_TYPES = [
  ['not_learned', '知识点没掌握'], ['confused', '两个概念混淆了'], ['misread', '审题失误'],
  ['careless', '粗心'], ['unsure', '说不清'], ['other', '其他原因'],
];
const UNSURE_TYPES = ['not_learned', 'confused', 'unsure', 'other'];
// 填空题的错误类型（同 SubjectiveErrorType.options(blank: true)）
const BLANK_ERROR_TYPES = [
  ['no_idea', '没有思路'], ['misremembered', '记错了公式或结论'], ['confused', '两个概念混淆了'],
  ['calculation', '计算或推导出错'], ['misread', '审题错误'], ['other', '其他原因'],
];

// ---- 打乱选项（同 iPad 的 OptionOrder）----

const OptionOrder = {
  make(keys, labels) {
    return {
      keys, labels,
      isShuffled: keys.join() !== labels.join(),
      label(k) { const i = keys.indexOf(k); return i >= 0 ? labels[i] : k; },
      /** 解析里明确指向选项的字母（「选项A」「A项」「故选A」「A正确」等）改成这次显示的字母，同 iPad 的 relabelOptionReferences */
      relabel(text) {
        if (!this.isShuffled) return text;
        const re = OptionOrder.referencePattern();
        return text.replace(re, (m, a, b, c, d) => {
          const letter = a || b || c || d;
          const at = m.lastIndexOf(letter);
          return m.slice(0, at) + this.label(letter) + m.slice(at + 1);
        });
      },
      /** 改过之后还剩单独的大写字母（可能指选项，也可能是公式变量）：提醒这些是原题的字母 */
      residualLetters(text) {
        return this.isShuffled && OptionOrder.mentionsLetters(text.replace(OptionOrder.referencePattern(), ''));
      },
    };
  },
  identity(keys) { return this.make(keys.slice(), keys.slice()); },
  referencePattern() {
    return /选项[ \t]*([A-H])|(?<![A-Za-z0-9])([A-H])[ \t]*项|(?:故选|应选|选择|选|答案[是为]|正确答案[是为])[ \t]*([A-H])(?![A-Za-z0-9])|(?<![A-Za-z0-9])([A-H])(?=[ \t]*(?:正确|错误|不正确|符合|不符合))/g;
  },
  isPinned(text) { return ['以上', '上述', '其他选项', '其余选项', '其他都', '其余都'].some(w => text.includes(w)); },
  mentionsOptions(text) {
    return /选项\s*[A-H](?![A-Za-z])|(?<![A-Za-z])[A-H]\s*(选项|项)|(?<![A-Za-z0-9])[A-H]\s*[、和与及或,，]\s*[A-H](?![A-Za-z0-9])/.test(text);
  },
  mentionsLetters(text) { return /(?<![A-Za-z])[A-H](?![A-Za-z])/.test(text); },
  shuffled(keys, texts, stem) {
    const sorted = keys.slice().sort();
    if (this.mentionsOptions(stem) || Object.values(texts).some(t => this.mentionsOptions(t))) return this.identity(sorted);
    const movable = sorted.map((k, i) => i).filter(i => !this.isPinned(texts[sorted[i]] || ''));
    if (movable.length < 2) return this.identity(sorted);
    const original = movable.map(i => sorted[i]);
    let picked;
    do {
      picked = original.slice();
      for (let i = picked.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [picked[i], picked[j]] = [picked[j], picked[i]];
      }
    } while (picked.join() === original.join());
    const order = sorted.slice();
    movable.forEach((pos, i) => { order[pos] = picked[i]; });
    return this.make(order, sorted);
  },
};

// ---- 选择题判分（同 iPad 的 Grader.grade，不算薄弱知识点：iPad 重新判分时算）----

function optionKeys(c) {
  switch (c.type) {
    case 'single': case 'multi': return Object.keys(c.options || {}).sort();
    case 'combo': return Object.keys(c.comboOptions || {}).sort();
    case 'multi_blank': return Object.keys(c.sharedOptions || {}).sort();
    case 'judge': return ['正确', '错误'];
  }
  return [];
}

function optionText(c, k) {
  if (c.type === 'combo') return (c.comboOptions[k] || []).map(roman).join('、');
  if (c.type === 'multi_blank') return (c.sharedOptions || {})[k] || '';
  return (c.options || {})[k] || '';
}

function encode(c, sel) {
  if (c.type === 'multi_blank') return sel.map(p => p == null ? '_' : p).join(',');
  return sel;
}

function complete(c, sel) {
  if (sel == null) return false;
  if (c.type === 'multi_blank') return sel.every(p => p != null);
  return sel.length > 0;
}

function grade(c, sel) {
  switch (c.type) {
    case 'single': case 'judge':
      return { correct: sel === c.answer, blanks: [], misjudged: [] };
    case 'combo': {
      const chosen = new Set(c.comboOptions[sel] || []), right = new Set(c.comboOptions[c.answer] || []);
      const misjudged = [...new Set([...chosen, ...right])].filter(k => chosen.has(k) !== right.has(k)).sort((a, b) => romanOrder(a) - romanOrder(b));
      const correct = sel === c.answer;
      return { correct, blanks: [], misjudged: correct ? [] : misjudged };
    }
    case 'multi': {
      const chosen = new Set(sel.split('')), right = new Set((c.answer || '').split(''));
      const blanks = optionKeys(c).map(k => chosen.has(k) === right.has(k));
      return { correct: chosen.size === right.size && [...chosen].every(k => right.has(k)), blanks, misjudged: [] };
    }
    case 'multi_blank': {
      const blanks = (c.blanks || []).map((b, i) => sel[i] === b.answer);
      return { correct: blanks.length > 0 && blanks.every(x => x), blanks, misjudged: [] };
    }
  }
  return { correct: false, blanks: [], misjudged: [] };
}

// ---- 一组一组地做 ----

let queue = [];
const shown = new Set();
let block = [], pos = 0, blockRight = 0, blockSkipped = 0, blockNo = 0;

function load() {
  startBlock(call('options').block || BLOCK);
}

function startBlock(size) {
  queue = call('queue').filter(q => !shown.has(q.key));
  if (!queue.length) return finished();
  let picked = [];
  // 第一组开头是几道上次做得好、又短的选择题热身（同 iPad 的 ReviewPlan.warmup）
  if (blockNo === 0) {
    picked = queue.filter(q => q.kind === 'choice' && (q.lastRating === 3 || q.lastRating === 4)
      && (q.estimatedSeconds || 30) <= 60).slice(0, 3);
  }
  for (const q of queue) { if (picked.length >= size) break; if (!picked.includes(q)) picked.push(q); }
  block = picked;
  pos = 0;
  blockRight = 0;
  blockSkipped = 0;
  blockNo++;
  show();
}

function show() {
  const q = block[pos];
  if (!q) return blockDone();
  shown.add(q.key);
  window.scrollTo(0, 0);
  if (q.kind === 'choice') choiceView(q); else blankView(q);
}

// 答完、还没点「下一题」的选择题：结果已经存了，之后改错因、看解析的时间要再存一次。
// 点「结束」、返回、切到后台时也存，作答不会丢；同一个 id 覆盖，不会多出记录
let pendingSave = null;
function flushPending() { if (pendingSave) pendingSave(); }
const pageVisibility = lpVisible;
window.lpVisible = v => { if (!v) flushPending(); pageVisibility(v); };
window.lpBack = () => { flushPending(); return false; };
function closePage() { flushPending(); call('close'); }

function advance(right) {
  pendingSave = null;
  if (right) blockRight++;
  pos++;
  show();
}

function blockDone() {
  const left = call('queue').filter(q => !shown.has(q.key)).length;
  app.innerHTML = '';
  app.appendChild(el(`<div class="card center"><div class="big">这组做完了</div>
    <p>答对 ${blockRight} / ${block.length - blockSkipped} 道${blockSkipped ? '（跳过 ' + blockSkipped + ' 道）' : ''}${left ? '，今天还有 ' + left + ' 道' : '，今天的题都做完了'}</p></div>`));
  const row = el('<div class="row"></div>');
  if (left) {
    const more = el(`<button class="btn">再来一组${left > BLOCK ? '（' + BLOCK + ' 道）' : ''}</button>`);
    more.onclick = () => startBlock(BLOCK);
    row.appendChild(more);
    if (left > BLOCK) {
      const big = el(`<button class="btn">再来 ${Math.min(BIG_BLOCK, left)} 道</button>`);
      big.onclick = () => startBlock(BIG_BLOCK);
      row.appendChild(big);
    }
  }
  const end = el(`<button class="btn ${left ? 'plain' : ''}">结束</button>`);
  end.onclick = () => call('close');
  row.appendChild(end);
  app.appendChild(row);
}

function finished() {
  app.innerHTML = '';
  app.appendChild(el(`<div class="card center"><div class="big">今天的题做完了</div>
    <p class="muted">手机上能做的复习题都做完了；综合题和跳过的题在 iPad 上做。</p></div>`));
  const end = el('<div class="row"><button class="btn">结束</button></div>');
  end.querySelector('button').onclick = () => call('close');
  app.appendChild(end);
}

function topBar(q, onSkip) {
  const bar = el(`<div class="top"><span>第 ${blockNo} 组 · ${pos + 1}/${block.length}</span>
    <span class="grow">· ${esc(q.packTitle)} ${esc(q.section)}</span></div>`);
  if (onSkip) {
    const skip = el('<button class="link">跳过</button>');
    skip.onclick = () => showMenu([
      ['今天先跳过（留给 iPad 做）', () => onSkip(false)],
      ['以后都不在手机上出这道题', () => onSkip(true)],
    ]);
    bar.appendChild(skip);
  }
  const fault = el(`<button class="link">${faulted.has(q.key) ? '已标有错' : '有错'}</button>`);
  if (faulted.has(q.key)) fault.style.color = 'var(--red)';
  fault.onclick = () => faultSheet(q, () => {
    // 还没作答：这道不做了，同跳过；作答过的留在这里，作答照样交给 iPad
    if (onSkip) { blockSkipped++; pos++; show(); } else bar.replaceWith(topBar(q, onSkip));
  });
  bar.appendChild(fault);
  const end = el('<button class="link">结束</button>');
  end.onclick = closePage;
  bar.appendChild(end);
  return bar;
}

// ---- 标记题目有错（同 iPad 的 QuestionFaultButton；FaultReason 里原题能选的几项）----

const FAULT_REASONS = [['wrong_answer', '答案或解析错误'], ['multiple_answers', '答案不唯一'], ['unclear', '题意不清']];
const faulted = new Map();   // 这次标了有错的题：key → {reasons, note}

function faultSheet(q, after) {
  const was = faulted.get(q.key);
  const reasons = new Set(was ? was.reasons : []);
  const m = el('<div class="menu"><div class="sheet"></div></div>');
  const sheet = m.querySelector('.sheet');
  sheet.insertAdjacentHTML('beforeend', `<div class="big" style="font-size:20px">${was ? '已标记这道题有错' : '标记这道题有错'}</div>
    <p class="muted">题干、选项、答案或解析有误时标记。和 iPad 同步后，复习、错题本和统计都不再使用这道题；可以在 iPad 上取消。</p>`);
  const reasonChips = () => chips(FAULT_REASONS, reasons, v => {
    if (reasons.has(v)) reasons.delete(v); else reasons.add(v);
    box.replaceWith(box = reasonChips());
  });
  let box = reasonChips();
  sheet.appendChild(box);
  const note = el('<textarea placeholder="哪里有错（选填），如：答案应为 C"></textarea>');
  note.value = was ? was.note : '';
  sheet.appendChild(note);
  const row = el('<div class="row"></div>');
  const close = () => m.remove();
  if (was) {
    const undo = el('<button class="btn plain">取消标记</button>');
    undo.onclick = () => {
      call('fault', { key: q.key, pack: q.pack, question: q.id, faulty: false });
      faulted.delete(q.key);
      close();
      after();
    };
    row.appendChild(undo);
  }
  const ok = el(`<button class="btn red">${was ? '保存' : '标记有错'}</button>`);
  ok.onclick = () => {
    const picked = FAULT_REASONS.map(r => r[0]).filter(r => reasons.has(r));
    call('fault', { key: q.key, pack: q.pack, question: q.id, faulty: true, reasons: picked, note: note.value.trim() || null });
    faulted.set(q.key, { reasons: picked, note: note.value.trim() });
    close();
    if (!was) after();
  };
  const cancel = el('<button class="btn plain">取消</button>');
  cancel.onclick = close;
  row.append(cancel, ok);
  sheet.appendChild(row);
  m.onclick = e => { if (e.target === m) close(); };
  document.body.appendChild(m);
}

function skipQuestion(q, forever) {
  call('skip', { key: q.key, pack: q.pack, question: q.id, forever });
  blockSkipped++;
  pos++;
  show();
}

function tags(c) {
  let s = '';
  if (c.type === 'multi') s += '<span class="tag teal">多选题</span>';
  if (c.type === 'judge') s += '<span class="tag teal">判断题</span>';
  if (c.aiWritten) s += `<span class="tag orange">${c.aiWritten === 'answer' ? 'AI解答' : 'AI解析'}</span>`;
  if (c.aiAuthored) s += '<span class="tag purple">AI 出题</span>';
  return s ? '<div>' + s + '</div>' : '';
}

function chips(options, selected, onToggle) {
  const box = el('<div class="chips"></div>');
  for (const [value, label] of options) {
    const b = el(`<button class="chip ${selected.has(value) ? 'on' : ''}"></button>`);
    b.textContent = label;
    b.onclick = () => onToggle(value);
    box.appendChild(b);
  }
  return box;
}

// ---- 选择题 ----

function choiceView(q) {
  const c = q.choice;
  const keys = optionKeys(c);
  const order = ['single', 'multi', 'combo'].includes(c.type)
    ? OptionOrder.shuffled(keys, c.type === 'combo' ? Object.fromEntries(keys.map(k => [k, optionText(c, k)])) : (c.options || {}), c.stem)
    : OptionOrder.identity(keys);
  const st = {
    sel: c.type === 'multi_blank' ? (c.blanks || []).map(() => null) : (c.type === 'multi' ? '' : null),
    history: [], times: [], clock: new Clock(), fb: new Clock(), result: null, confidence: null, at: 0,
    causes: new Set(), note: '',
  };
  st.clock.start();

  const choose = sel => {
    if (st.result) return;
    st.sel = sel;
    st.history.push(encode(c, sel));
    st.times.push(Math.round(st.clock.seconds * 10) / 10);
    render();
  };

  const submit = confidence => {
    st.clock.stop();
    st.confidence = confidence;
    st.at = Date.now();
    st.result = grade(c, st.sel);
    if (!st.result.correct) st.causes = new Set(['not_learned']);
    st.fb.start();
    st.id = uuid();
    st.session = call('session', { workStarted: st.at - st.clock.seconds * 1000 });
    pendingSave = save;
    save();
    render();
    window.scrollTo(0, 0);
  };

  const save = () => {
    const duration = Math.round(st.clock.seconds * 10) / 10;
    const showCauses = !st.result.correct || st.confidence !== 'sure';
    const result = {
      id: st.id, type: 'choice', pack: q.pack, question: q.id, contentHash: q.contentHash,
      at: st.at, duration, selection: encode(c, st.sel), selectionHistory: st.history, selectionTimes: st.times,
      optionOrder: order.isShuffled ? order.keys : [], confidence: st.confidence,
      feedbackSeconds: Math.round(st.fb.seconds * 10) / 10,
      errorTypes: showCauses ? ERROR_TYPES.map(t => t[0]).filter(t => st.causes.has(t)) : [],
      errorNote: showCauses && st.note.trim() ? st.note.trim() : null,
      sessionID: st.session.sessionID, sessionIndex: st.session.sessionIndex,
    };
    call('submit', { key: q.key, result });
  };

  const next = () => {
    st.fb.stop();
    save();
    advance(st.result.correct);
  };

  function render() {
    app.innerHTML = '';
    app.appendChild(topBar(q, st.result ? null : forever => skipQuestion(q, forever)));
    const card = el('<div class="card"></div>');
    card.insertAdjacentHTML('beforeend', tags(c));
    let stem = c.stem;
    if (c.type === 'multi_blank') { let i = 0; stem = stem.replace(/（ ）/g, () => '（' + CIRCLED[Math.min(i++, 9)] + '）'); }
    card.insertAdjacentHTML('beforeend', '<div class="stem">' + inline(stem) + '</div>');
    for (const f of c.figures || []) card.insertAdjacentHTML('beforeend', figureHTML(f, q.images));

    if (c.type === 'combo' && c.statements) {
      const box = el('<div class="statements"></div>');
      for (const k of Object.keys(c.statements).sort((a, b) => romanOrder(a) - romanOrder(b))) {
        const s = c.statements[k];
        const truth = st.result ? ` <b style="color:var(--${s.truth ? 'green' : 'red'})">${s.truth ? '✓ 正确' : '✗ 错误'}</b>` : '';
        box.insertAdjacentHTML('beforeend', `<div><b>${roman(k)}.</b> ${inline(s.text)}${truth}</div>`);
      }
      card.appendChild(box);
    }

    if (c.type === 'multi_blank') {
      const shared = el('<div class="muted"></div>');
      shared.innerHTML = keys.map(k => `${k}. ${inline(optionText(c, k))}`).join('<br>');
      card.appendChild(shared);
      (c.blanks || []).forEach((b, i) => {
        const row = el(`<div class="blankrow"><span class="label">第${CIRCLED[Math.min(i, 9)]}空</span></div>`);
        for (const k of keys) {
          let cls = st.sel[i] === k ? 'on' : '';
          if (st.result) cls = k === b.answer ? 'right' : (st.sel[i] === k ? 'wrong' : '');
          const btn = el(`<button class="pill ${cls}">${esc(k)}</button>`);
          btn.onclick = () => { const s = st.sel.slice(); s[i] = k; choose(s); };
          row.appendChild(btn);
        }
        card.appendChild(row);
      });
    } else {
      const multi = c.type === 'multi';
      const picked = new Set(multi ? (st.sel || '').split('').filter(Boolean) : (st.sel ? [st.sel] : []));
      const answers = new Set(multi ? (c.answer || '').split('') : [c.answer]);
      for (const k of order.keys) {
        let cls = picked.has(k) ? 'chosen' : '', side = '';
        if (st.result) {
          if (multi && !picked.has(k) && answers.has(k)) { cls = 'missed'; side = '漏选'; }
          else if (answers.has(k)) cls = 'right';
          else if (picked.has(k)) cls = 'wrong';
          else cls = '';
          if (order.isShuffled) side += (side ? ' · ' : '') + '原 ' + k;
        }
        const label = c.type === 'judge' ? '' : `<span class="key">${esc(order.label(k))}.</span>`;
        const row = el(`<div class="option ${cls}">${label}<span class="text">${inline(optionText(c, k))}</span><span class="side">${esc(side)}</span></div>`);
        row.onclick = () => {
          if (!multi) return choose(k);
          const s = new Set(picked);
          if (s.has(k)) s.delete(k); else s.add(k);
          choose([...s].sort().join(''));
        };
        card.appendChild(row);
      }
    }
    app.appendChild(card);

    if (!st.result) {
      const row = el('<div class="row"></div>');
      for (const [conf, label, color] of [['sure', '确定', 'green'], ['unsure', '犹豫', 'orange'], ['guess', '蒙的', 'gray']]) {
        const b = el(`<button class="btn ${color}">${label}</button>`);
        b.disabled = !complete(c, st.sel);
        b.onclick = () => submit(conf);
        row.appendChild(b);
      }
      app.appendChild(row);
      return;
    }

    const r = st.result;
    // 「下一题」紧跟在题目下面，不用翻过解析、错因去找；错因选了「其他原因」要写了原因才能点
    const canNext = () => !st.causes.has('other') || st.note.trim().length > 0 || (r.correct && st.confidence === 'sure');
    const row = el('<div class="row"></div>');
    const nextBtn = el('<button class="btn">下一题</button>');
    nextBtn.disabled = !canNext();
    nextBtn.onclick = next;
    row.appendChild(nextBtn);
    app.appendChild(row);

    const fb = el('<div class="card"></div>');
    let answerText;
    if (c.type === 'multi_blank') answerText = (c.blanks || []).map((b, i) => CIRCLED[Math.min(i, 9)] + b.answer).join(' ');
    else if (c.type === 'multi') answerText = (c.answer || '').split('').map(k => order.label(k)).sort().join('');
    else if (c.type === 'judge') answerText = c.answer;
    else answerText = order.label(c.answer);
    fb.insertAdjacentHTML('beforeend', r.correct
      ? `<div class="banner right">答对了${st.confidence === 'sure' ? '' : (st.confidence === 'guess' ? '（蒙的）' : '（犹豫）')}</div>`
      : `<div class="banner wrong">答错了，正确答案：${esc(answerText)}</div>`);
    if (r.misjudged.length) fb.insertAdjacentHTML('beforeend', `<p class="muted">判断错的：${r.misjudged.map(roman).join('、')}</p>`);
    fb.insertAdjacentHTML('beforeend', `<b>${c.aiAuthored || c.aiWritten ? '解析（AI 编写）' : '解析'}</b>`);
    if (order.residualLetters(c.explanation || '')) {
      fb.insertAdjacentHTML('beforeend', '<p class="muted">解析里指明是选项的字母已换成这次的字母；其余单独的字母是原题的，对照各选项右侧的「原 X」</p>');
    }
    fb.insertAdjacentHTML('beforeend', md(order.relabel(c.explanation || ''), q.images));
    if (c.explanationAdds && c.explanationAdds.length) {
      fb.insertAdjacentHTML('beforeend', '<p class="muted">解析里出现的新知识：</p><ul>'
        + c.explanationAdds.map(a => '<li>' + inline(a) + '</li>').join('') + '</ul>');
    }
    app.appendChild(fb);

    if (!r.correct || st.confidence !== 'sure') {
      const cause = el(`<div class="card"><b>${r.correct ? '为什么没把握？（可不选）' : '错在哪里？'}</b></div>`);
      let options = r.correct ? ERROR_TYPES.filter(t => UNSURE_TYPES.includes(t[0])) : ERROR_TYPES;
      if (!r.correct && c.polarity === 'negative') options = [options.find(t => t[0] === 'misread')].concat(options.filter(t => t[0] !== 'misread'));
      cause.appendChild(chips(options, st.causes, v => {
        if (st.causes.has(v)) st.causes.delete(v); else st.causes.add(v);
        render();
      }));
      if (st.causes.has('other')) {
        const note = el('<textarea placeholder="写下原因"></textarea>');
        note.value = st.note;
        note.oninput = () => { st.note = note.value; nextBtn.disabled = !canNext(); };
        cause.appendChild(note);
      }
      app.appendChild(cause);
    }
  }

  render();
}

// ---- 填空题 ----

function blankView(q) {
  const b = q.blank;
  const parts = b.parts || [];
  const st = {
    inputs: parts.map(() => ''), clock: new Clock(), fb: new Clock(), createdAt: Date.now(),
    revealedAt: 0, confidence: null, results: {}, causes: {}, notes: {}, auto: [], session: null,
  };
  st.clock.start();

  const reveal = confidence => {
    st.clock.stop();
    st.confidence = confidence;
    st.revealedAt = Date.now();
    st.session = call('session', { workStarted: st.revealedAt - st.clock.seconds * 1000 });
    if (b.typed) {
      st.inputs = st.inputs.map(s => s.trim());
      st.auto = parts.filter((p, i) => BlankMatcher.matches(st.inputs[i], p.accept || [])).map(p => p.label);
      parts.forEach((p, i) => {
        if (st.auto.includes(p.label)) st.results[p.label] = 'correct';
        else if (BlankMatcher.isEmpty(st.inputs[i])) st.results[p.label] = 'blank';
      });
    }
    st.fb.start();
    // 键盘填空全部和答案一致：直接记做对（同 iPad）
    if (b.typed && parts.length && st.auto.length === parts.length) return done(save());
    render();
  };

  const save = () => {
    st.fb.stop();
    const labels = parts.map(p => p.label);
    const result = {
      id: uuid(), type: 'blank', pack: q.pack, question: q.id, contentHash: q.contentHash,
      createdAt: st.createdAt, revealedAt: st.revealedAt, assessedAt: Date.now(),
      writingSeconds: Math.round(st.clock.seconds * 10) / 10, feedbackSeconds: Math.round(st.fb.seconds * 10) / 10,
      confidence: st.confidence, typedAnswers: b.typed ? st.inputs : [], autoMatched: st.auto,
      partLabels: labels, partResults: labels.map(l => st.results[l]),
      partCauses: labels.filter(l => st.results[l] === 'wrong' || st.results[l] === 'blank').map(l => ({
        label: l, errorTypes: BLANK_ERROR_TYPES.map(t => t[0]).filter(t => (st.causes[l] || new Set()).has(t)),
        note: (st.notes[l] || '').trim() || null,
      })),
      sessionID: st.session.sessionID, sessionIndex: st.session.sessionIndex,
    };
    call('submit', { key: q.key, result });
    return labels.every(l => st.results[l] === 'correct');
  };

  const done = right => {
    app.innerHTML = '';
    app.appendChild(topBar(q, null));
    const card = questionCard();
    parts.forEach((p, i) => card.insertAdjacentHTML('beforeend',
      `<div class="muted">${esc(p.label)} 你填：<span style="color:var(--green)">${esc(st.inputs[i])}</span> ✓</div>`));
    app.appendChild(card);
    const row = el('<div class="row"><button class="btn">下一题</button></div>');
    row.querySelector('button').onclick = () => advance(right);
    app.appendChild(row);
    app.appendChild(el('<div class="card"><div class="banner right">全部填对了</div></div>'));
    app.appendChild(answerCard());
  };

  function questionCard() {
    const card = el('<div class="card"></div>');
    if (b.aiAuthored) card.insertAdjacentHTML('beforeend', '<div><span class="tag purple">AI 出题</span></div>');
    card.insertAdjacentHTML('beforeend', '<div class="stem">' + md(b.stem, q.images) + '</div>');
    if (b.questionImage) card.insertAdjacentHTML('beforeend', figureHTML(b.questionImage, q.images));
    return card;
  }

  function answerCard() {
    const card = el('<div class="card"><b>答案</b></div>');
    if (b.answer) card.insertAdjacentHTML('beforeend', md(b.answer, q.images));
    for (const img of b.answerImages || []) card.insertAdjacentHTML('beforeend', figureHTML(img, q.images));
    return card;
  }

  const canSubmit = () => parts.every(p => st.results[p.label])
    && parts.every(p => !(st.causes[p.label] || new Set()).has('other') || (st.notes[p.label] || '').trim());

  function render() {
    app.innerHTML = '';
    app.appendChild(topBar(q, st.revealedAt ? null : forever => skipQuestion(q, forever)));
    const card = questionCard();
    if (b.typed && !st.revealedAt) {
      parts.forEach((p, i) => {
        const row = el(`<div class="blankrow"><span class="label">${esc(p.label)}</span></div>`);
        const input = el('<input type="text" autocomplete="off" autocapitalize="off" spellcheck="false">');
        input.value = st.inputs[i];
        input.style.flex = '1';
        input.oninput = () => { st.inputs[i] = input.value; };
        row.appendChild(input);
        card.appendChild(row);
      });
    }
    app.appendChild(card);

    if (!st.revealedAt) {
      if (!b.typed) app.appendChild(el('<p class="muted">在心里或草稿纸上做出来，再看答案自评。要写很多的题可以跳过，留给 iPad。</p>'));
      const row = el('<div class="row"></div>');
      for (const [conf, label, color] of [['sure', '有把握', 'green'], ['unsure', '不确定', 'orange'], ['gave_up', '不会做', 'gray']]) {
        const btn = el(`<button class="btn ${color}">${label}</button>`);
        btn.onclick = () => reveal(conf);
        row.appendChild(btn);
      }
      app.appendChild(row);
      return;
    }

    app.appendChild(answerCard());
    const assess = el('<div class="card"><b>逐空自评</b></div>');
    parts.forEach((p, i) => {
      const box = el(`<div class="part"><div><b>${esc(p.label)}</b> 答案：${inline(p.answer || (p.accept || [])[0] || '')}</div></div>`);
      if (b.typed) {
        const ok = st.auto.includes(p.label);
        box.insertAdjacentHTML('beforeend', `<div class="muted">你填：<span style="color:var(--${ok ? 'green' : 'red'})">${esc(st.inputs[i] || '（没填）')}</span>${ok ? ' ✓' : ''}</div>`);
      }
      const row = el('<div class="blankrow"></div>');
      for (const [value, label] of [['correct', '对'], ['wrong', '错'], ['blank', '没做出来']]) {
        const btn = el(`<button class="pill ${st.results[p.label] === value ? 'on' : ''}">${label}</button>`);
        btn.onclick = () => { st.results[p.label] = value; render(); };
        row.appendChild(btn);
      }
      box.appendChild(row);
      const r = st.results[p.label];
      if (r === 'wrong' || r === 'blank') {
        const set = st.causes[p.label] || (st.causes[p.label] = new Set());
        box.appendChild(chips(BLANK_ERROR_TYPES, set, v => { if (set.has(v)) set.delete(v); else set.add(v); render(); }));
        if (set.has('other')) {
          const note = el('<textarea placeholder="写下原因"></textarea>');
          note.value = st.notes[p.label] || '';
          note.oninput = () => { st.notes[p.label] = note.value; submitBtn.disabled = !canSubmit(); };
          box.appendChild(note);
        }
      }
      assess.appendChild(box);
    });
    app.appendChild(assess);
    const row = el('<div class="row"></div>');
    const submitBtn = el('<button class="btn">提交自评，下一题</button>');
    submitBtn.disabled = !canSubmit();
    submitBtn.onclick = () => advance(save());
    row.appendChild(submitBtn);
    app.appendChild(row);
  }

  render();
}

try { load(); } catch (e) { app.innerHTML = '<div class="card">出错了：' + esc(e.message) + '</div>'; }
