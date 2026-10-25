// 三个页面共用：调 Java（window.Android）、只算亮屏时间的计时器、Markdown 和公式显示、填空比对。
'use strict';

// ---- 调 Java ----

function call(method, args) {
  const r = JSON.parse(Android.call(method, JSON.stringify(args || {})));
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const pendingCalls = {};
let callSeq = 0;

/** 放到后台线程做的调用（如请求 AI），返回 Promise */
function callAsync(method, args) {
  return new Promise((resolve, reject) => {
    const id = 'c' + (++callSeq);
    pendingCalls[id] = { resolve, reject };
    Android.callAsync(method, JSON.stringify(args || {}), id);
  });
}

function lpResolve(id, r) {
  const p = pendingCalls[id];
  delete pendingCalls[id];
  if (!p) return;
  if (r.ok) p.resolve(r.value); else p.reject(new Error(r.error));
}

// ---- 计时：只算 App 在前台、亮屏的时间（同 iPad 的 ActiveClock）----

let pageVisible = !document.hidden;
const clocks = new Set();

class Clock {
  constructor() { this.acc = 0; this.since = null; this.running = false; clocks.add(this); }
  start() { this.running = true; if (pageVisible && this.since === null) this.since = performance.now(); }
  stop() { this._pause(); this.running = false; }
  reset() { this.acc = 0; this.since = null; this.running = false; }
  _pause() { if (this.since !== null) { this.acc += performance.now() - this.since; this.since = null; } }
  _resume() { if (this.running && this.since === null) this.since = performance.now(); }
  get seconds() { return (this.acc + (this.since === null ? 0 : performance.now() - this.since)) / 1000; }
}

function lpVisible(v) {
  pageVisible = v;
  for (const c of clocks) { if (v) c._resume(); else c._pause(); }
}
document.addEventListener('visibilitychange', () => lpVisible(!document.hidden));

// ---- HTML、Markdown、公式 ----

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function tex(src, display) {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore' });
  } catch (e) {
    return esc(display ? '$$' + src + '$$' : '$' + src + '$');
  }
}

/** 行内：$…$ 公式、`代码`、**粗体**、*斜体*；换行变 <br> */
function inline(text) {
  const keep = [];
  const hold = html => '\u0000' + (keep.push(html) - 1) + '\u0000';
  let s = String(text == null ? '' : text);
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold('<code>' + esc(c) + '</code>'));
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => hold(tex(m, true)));
  s = s.replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, pre, m) => pre + hold(tex(m, false)));
  s = esc(s);
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  s = s.replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
}

/** 图：images 是 图 id / "img:<sha>" → {sha, caption} */
function figureHTML(id, images) {
  const img = images && images[id];
  if (!img) return '<p class="muted">（图 ' + esc(id) + ' 没有同步过来）</p>';
  return '<figure><img src="/img/' + esc(img.sha) + '">' + (img.caption ? '<figcaption>' + inline(img.caption) + '</figcaption>' : '') + '</figure>';
}

/** Markdown（解析、答案）：段落、标题、列表、代码块、表格、$$ 公式、单独一行的 [[图 id]] */
function md(text, images) {
  const lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0, para = [];
  const flush = () => { if (para.length) { out.push('<p>' + inline(para.join('\n')) + '</p>'); para = []; } };
  while (i < lines.length) {
    const line = lines[i], t = line.trim();
    if (t.startsWith('```')) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
      continue;
    }
    if (t.startsWith('$$') && !(t.length > 4 && t.endsWith('$$'))) {
      flush();
      const m = [t.slice(2)];
      i++;
      while (i < lines.length && !lines[i].trim().endsWith('$$')) m.push(lines[i++]);
      if (i < lines.length) m.push(lines[i].trim().slice(0, -2));
      i++;
      out.push(tex(m.join('\n'), true));
      continue;
    }
    const fig = t.match(/^\[\[图[\s:：]*(.+?)\s*\]\]$/);
    if (fig) { flush(); out.push(figureHTML(fig[1], images)); i++; continue; }
    if (t === '') { flush(); i++; continue; }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
    if (t.startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => inline(c.trim()));
      let html = '<table><tr>' + cells(line).map(c => '<th>' + c + '</th>').join('') + '</tr>';
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        html += '<tr>' + cells(lines[i]).map(c => '<td>' + c + '</td>').join('') + '</tr>';
        i++;
      }
      out.push(html + '</table>');
      continue;
    }
    const li = t.match(/^([-*•]|\d+[.、)])\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /^\d/.test(li[1]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].trim().match(/^([-*•]|\d+[.、)])\s+(.*)$/);
        if (!m) break;
        items.push('<li>' + inline(m[2]) + '</li>');
        i++;
      }
      out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return '<div class="md">' + out.join('') + '</div>';
}

// ---- 填空比对（同 iPad 的 BlankMatcher）----

const BlankMatcher = {
  /** 全角转半角（NFKC）、去掉空白和包裹的 $、去掉末尾标点、小写 */
  normalize(s) {
    let t = String(s || '').normalize('NFKC').replace(/\s/g, '');
    while (t.length >= 2 && t.startsWith('$') && t.endsWith('$')) t = t.slice(1, -1);
    while (t.length && '。.，,；;、'.includes(t[t.length - 1])) t = t.slice(0, -1);
    return t.toLowerCase();
  },
  plain(s) {
    if (!s || !/^[0-9+\-.]+$/.test(s) || !/[0-9]/.test(s)) return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  },
  number(n) {
    const parts = n.split('/');
    if (parts.length === 2) {
      const a = this.plain(parts[0]), b = this.plain(parts[1]);
      return a === null || b === null || b === 0 ? null : a / b;
    }
    return this.plain(n);
  },
  matches(input, accept) {
    const a = this.normalize(input);
    if (!a) return false;
    const n = this.number(a);
    return (accept || []).some(c => {
      const b = this.normalize(c);
      if (a === b) return true;
      const m = this.number(b);
      return n !== null && m !== null && Math.abs(n - m) <= 1e-9 * Math.max(1, Math.abs(n), Math.abs(m));
    });
  },
  isEmpty(input) { return !this.normalize(input); },
};

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function showMenu(items) {
  const m = el('<div class="menu"><div class="sheet"></div></div>');
  const sheet = m.querySelector('.sheet');
  for (const [label, fn] of items.concat([['取消', null]])) {
    const b = el('<button></button>');
    b.textContent = label;
    b.onclick = () => { m.remove(); if (fn) fn(); };
    sheet.appendChild(b);
  }
  m.onclick = e => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);
}
