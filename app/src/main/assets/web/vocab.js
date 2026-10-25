// 背单词（同 iPad 的 VocabReviewSession）：看原句里标黄的词想意思，显示释义后自评。
// 「不认识」的词放到最后，这次结束前再出现一次；每次自评都记一条结果，等 iPad 来取（PROTOCOL.md 的 vocab）
'use strict';

const app = document.getElementById('app');
let queue = [];
let total = 0, done = 0;
let revealed = false;

function load() {
  queue = call('due');
  total = queue.length;
  show();
}

function highlighted(sentence, word) {
  const i = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0 || !word) return esc(sentence);
  return esc(sentence.slice(0, i)) + '<span class="word">' + esc(sentence.slice(i, i + word.length)) + '</span>'
    + esc(sentence.slice(i + word.length));
}

function show() {
  const e = queue[0];
  app.innerHTML = '';
  if (!e) {
    app.appendChild(el(`<div class="card center"><div class="big">背完了</div><p>这次背了 ${done} 次</p></div>`));
    const row = el('<div class="row"><button class="btn">结束</button></div>');
    row.querySelector('button').onclick = () => call('close');
    app.appendChild(row);
    return;
  }
  const bar = el(`<div class="top"><span class="grow">还剩 ${queue.length} 个</span></div>`);
  const end = el('<button class="link">结束</button>');
  end.onclick = () => call('close');
  bar.appendChild(end);
  app.appendChild(bar);

  const card = el('<div class="card"></div>');
  card.insertAdjacentHTML('beforeend', `<div><span class="tag ${e.isNew ? 'orange' : 'teal'}">${e.isNew ? '新词' : '复习'}</span></div>`);
  card.insertAdjacentHTML('beforeend', `<p style="font-size:19px">${highlighted(e.sentence || e.word, e.word)}</p>`);
  const speak = el('<button class="link">朗读句子</button>');
  speak.onclick = () => call('speak', { text: e.sentence || e.word });
  card.appendChild(speak);
  if (!revealed) card.insertAdjacentHTML('beforeend', '<p class="muted">标黄的词在这句里是什么意思？</p>');
  app.appendChild(card);

  if (!revealed) {
    const row = el('<div class="row"><button class="btn">显示释义</button></div>');
    row.querySelector('button').onclick = () => { revealed = true; show(); };
    app.appendChild(row);
    return;
  }

  const back = el('<div class="card"></div>');
  back.insertAdjacentHTML('beforeend', `<div><span class="big">${esc(e.word)}</span> <span class="muted">${esc(e.phonetic || '')}</span></div>`);
  const sw = el('<button class="link">朗读单词</button>');
  sw.onclick = () => call('speak', { text: e.word });
  back.appendChild(sw);
  back.insertAdjacentHTML('beforeend', e.meaning ? `<p>${esc(e.meaning)}</p>` : '<p class="muted">还没有释义（在 iPad 上生成）</p>');
  if (e.form) back.insertAdjacentHTML('beforeend', `<p style="color:var(--orange)">原形：${esc(e.form)}</p>`);
  if (e.note) back.insertAdjacentHTML('beforeend', `<p class="muted">其他意思：${esc(e.note)}</p>`);
  if (e.source) back.insertAdjacentHTML('beforeend', `<p class="muted">${esc(e.source)}</p>`);
  app.appendChild(back);

  const row = el('<div class="row"></div>');
  for (const [rating, label, color] of [[1, '不认识', 'red'], [2, '模糊', 'orange'], [3, '认识', 'green'], [4, '太简单', 'blue']]) {
    const b = el(`<button class="btn ${color}">${label}</button>`);
    b.onclick = () => rate(e, rating);
    row.appendChild(b);
  }
  app.appendChild(row);
}

function rate(e, rating) {
  call('rate', { key: e.key, rating });
  done++;
  queue.shift();
  // 不认识：放到最后，这次结束前再出现一次（同 iPad）
  if (rating === 1) queue.push(Object.assign({}, e, { isNew: false }));
  revealed = false;
  show();
}

window.lpBack = () => false;
try { load(); } catch (err) { app.innerHTML = '<div class="card">出错了：' + esc(err.message) + '</div>'; }
