// 背说法卡（同 iPad 的 PhraseReviewSession）：看说法，说出它指的是什么，再翻面对照（背面列出易混的说法）、自评。
// 「重来」的卡放到最后，这次结束前再出现一次；每次自评都记一条结果，等 iPad 来取（PROTOCOL.md 的 phrase）
'use strict';

const app = document.getElementById('app');
let queue = [];
let done = 0;
let revealed = false;

const TAGS = { new: ['新卡', 'blue'], seeded: ['原题选错过', 'red'], relearn: ['重来', 'red'], review: ['复习', 'orange'] };

function load() {
  queue = call('due');
  show();
}

// 说法里的 **关键词** 加粗
function cue(s) {
  return esc(s || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function show() {
  const c = queue[0];
  app.innerHTML = '';
  if (!c) {
    app.appendChild(el(`<div class="card center"><div class="big">背完了</div><p>这次背了 ${done} 次</p></div>`));
    const row = el('<div class="row"><button class="btn">结束</button></div>');
    row.querySelector('button').onclick = () => call('close');
    app.appendChild(row);
    return;
  }
  const bar = el(`<div class="top"><span class="grow">还剩 ${queue.length} 张</span></div>`);
  const end = el('<button class="link">结束</button>');
  end.onclick = () => call('close');
  bar.appendChild(end);
  app.appendChild(bar);

  const [tag, color] = TAGS[c.tag] || TAGS.review;
  const card = el('<div class="card"></div>');
  card.insertAdjacentHTML('beforeend', `<div><span class="tag ${color}">${tag}</span>`
    + `<span class="muted" style="font-size:12px">${esc((c.sources || []).join(' · '))}</span></div>`);
  card.insertAdjacentHTML('beforeend', `<p style="font-size:21px">${cue(c.cue)}</p>`);
  if (!revealed) card.insertAdjacentHTML('beforeend', '<p class="muted">先说出它指的是什么，再翻面。</p>');
  app.appendChild(card);

  if (!revealed) {
    const row = el('<div class="row"><button class="btn">翻面</button></div>');
    row.querySelector('button').onclick = () => { revealed = true; show(); };
    app.appendChild(row);
    return;
  }

  const back = el('<div class="card"></div>');
  back.insertAdjacentHTML('beforeend', `<div class="big">${esc(c.answer)}</div>`);
  if ((c.confusable || []).length) {
    const box = el('<div class="confuse"><p style="color:var(--orange);font-weight:600">别和这些混</p></div>');
    for (const o of c.confusable) box.insertAdjacentHTML('beforeend', `<p>${cue(o.cue)} → <b>${esc(o.answer)}</b></p>`);
    back.appendChild(box);
  }
  app.appendChild(back);

  const row = el('<div class="row"></div>');
  for (const [rating, label, color] of [[1, '重来', 'red'], [2, '模糊', 'orange'], [3, '记得', 'green'], [4, '太简单', 'blue']]) {
    const b = el(`<button class="btn ${color}">${label}</button>`);
    b.onclick = () => rate(c, rating);
    row.appendChild(b);
  }
  app.appendChild(row);
  app.appendChild(el('<p class="muted" style="font-size:13px">说对而且没犹豫算「记得」；犹豫过、在两个之间挑的算「模糊」；说错或说不出算「重来」。</p>'));
}

function rate(c, rating) {
  call('rate', { key: c.key, rating });
  done++;
  queue.shift();
  // 重来：放到最后，这次结束前再出现一次（同 iPad）
  if (rating === 1) queue.push(Object.assign({}, c, { tag: 'relearn' }));
  revealed = false;
  show();
}

window.lpBack = () => false;
try { load(); } catch (err) { app.innerHTML = '<div class="card">出错了：' + esc(err.message) + '</div>'; }
